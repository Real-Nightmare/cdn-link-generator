// filter-apis/registry — the Filters Checker backend, ported from the uploaded
// filter-apis package so it runs entirely in the browser.
//
// Same contract as the original registry script:
//   FILTERS              — one FilterDef per filtering service
//   checkUrl(url)        — Promise<FilterResult[]> across every filter
//   checkDomains(...)    — batch runner (./runner)
//
// Endpoint classes:
//   • native  — the endpoint sends CORS headers, fetchable directly
//               (Blocksi ×2, Deledao, Sophos SXL4, Lightspeed WebSocket, DoH)
//   • server  — no CORS headers; called through /api/filter, a server-side
//               proxy deployed alongside the site (FortiGuard, Senso,
//               Linewize, Barracuda). Falls back to a public CORS relay when
//               the API isn't present (e.g. static previews).
//
// Adapters the uploaded package disabled for dead/rotated endpoints
// (GoGuardian, Securly, Palo Alto, LanSchool, iBoss, ContentKeeper, Cisco)
// stay disabled here for the same reasons.

import type { FilterDef, FilterResult } from "./types";
import { cloudflareSecurity } from "./cloudflare-security";
import { cloudflareFamily } from "./cloudflare-family";
import { cleanbrowsingSecurity } from "./cleanbrowsing-security";
import { cleanbrowsingFamily } from "./cleanbrowsing-family";
import { opendnsFamilyShield } from "./opendns-familyshield";
import { getSharedLightspeed } from "./lightspeed";
import { blocksiAI, blocksiStandard } from "./vendor/blocksi";
import { deledao } from "./vendor/deledao";
// Static import on purpose: this registry is bundled into the Web Worker,
// which Vite builds as IIFE — a dynamic import here would force code-splitting
// and fail the production build ("UMD and IIFE output formats are not
// supported for code-splitting builds").
import { sophos } from "./vendor/sophos";

import fortiguardCats from "./vendor/json/fortiguard.json";
import sensoCats from "./vendor/json/senso.json";

export type { FilterDef, FilterResult, DomainFilterResult } from "./types";

const FG_CATS = fortiguardCats as Record<string, { category: string; blocked: boolean }>;
const SENSO_CATS = sensoCats as unknown as Record<string, [string, boolean]>;

/** Server proxy for filters whose endpoints send no CORS headers. */
const FILTER_API = "/api/filter";

/** Fallback relay for static previews where /api/filter doesn't exist. */
async function relayText(url: string, timeoutMs = 20000): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`relay ${res.status}`);
  return res.text();
}

async function relayJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const text = await relayText(url, timeoutMs);
  const obj = text.indexOf("{");
  const arr = text.indexOf("[");
  const idx = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  if (idx === -1) throw new Error("relay returned no JSON");
  return JSON.parse(text.slice(idx)) as T;
}

/**
 * Call /api/filter with graceful fallback to the public CORS relay so the
 * Filter Checker still works on static previews without the Python API.
 */
async function serverCheck<T>(kind: string, url: string, allow404AsOff = false): Promise<T> {
  try {
    const res = await fetch(`${FILTER_API}?kind=${kind}&url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const j = (await res.json()) as { result?: T; error?: string };
      if (j.error) throw new Error(j.error);
      if (j.result !== undefined) return j.result;
      throw new Error("empty api result");
    }
    if (res.status < 500 && res.status !== 404) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `api ${res.status}`);
    }
    throw new Error(`api ${res.status}`);
  } catch (err) {
    // /api/filter absent (static preview) → fall back to the relay. The relay
    // 404s on unknown hosts — treat that as "off" when the caller asked.
    if (err instanceof TypeError || /api (404|50[0-9])/.test(String((err as Error).message))) {
      if (allow404AsOff && /api 404/.test(String((err as Error).message))) {
        return { category: "", blocked: false } as T;
      }
      return relayFallback(kind, url) as Promise<T>;
    }
    throw err;
  }
}

/** Relay paths that can approximate each server check (best-effort). */
function relayFallback(kind: string, url: string): Promise<unknown> {
  switch (kind) {
    case "fortiguard":
      return relayJson<{ data?: unknown[] }>(
        "https://wsfgd1.fortiguard.net:3400/service/wfquery" +
          "?protver=1.0&cltkey=bossbaby&emssn=lol&clttype=ie&type=cate&catver=10&qurl=" +
          encodeURIComponent(url),
      );
    case "senso":
      return relayJson<unknown[]>("https://filtering.senso.cloud/filter/lookup?url=https://" + url);
    case "linewize":
      return relayJson<{ signatures?: { category?: string; subCategory?: string } }>(
        "https://mvgateway.syd-1.linewize.net/get/verdict" +
          "?deviceid=PHYS-SMIC-US-0000-3190&cev=3.3.0&identity=null&requested_website=" +
          encodeURIComponent(url),
      );
    default:
      return Promise.reject(new Error(`${kind} requires the server API`));
  }
}

function asText(x: unknown): string {
  if (x == null) return "";
  if (Array.isArray(x)) return String((x as unknown[])[0] ?? "");
  if (typeof x === "object")
    return String((x as { category?: string }).category ?? (x as { name?: string }).name ?? "");
  return String(x);
}

const isErr = (x: unknown) => x === "Error" || x == null;

// Sophos allow-list: only clearly work/school-safe categories pass.
const SOPHOS_ALLOWED_PROD = new Set([
  0, 6, 7, 8, 10, 13, 16, 20, 23, 25, 29, 39, 41, 42, 55, 57, 61, 62, 64, 68,
]);

// ── Vendored adapter plumbing ────────────────────────────────────────────────

/** Accept a bare domain OR a full URL with path/query. Each adapter takes the
 * form its endpoint supports: `full` (scheme + path), `hostPath` (no scheme),
 * or `host` (domain only, for APIs that can't see paths). */
function target(input: string): { host: string; full: string; hostPath: string } {
  let s = String(input || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  let u: URL | null = null;
  try {
    u = new URL(s);
  } catch {
    /* not a URL — treat as bare host */
  }
  const host = (u ? u.hostname : String(input).trim()).toLowerCase().replace(/^www\./, "");
  const full = u ? u.toString() : `http://${host}/`;
  const hostPath = full.replace(/^https?:\/\//i, "");
  return { host, full, hostPath };
}

// ── The filter list ──────────────────────────────────────────────────────────

export const FILTERS: FilterDef[] = [
  {
    name: "Lightspeed",
    short: "LS",
    description: "Lightspeed Filter (Rocket) — live WebSocket agent lookup",
    kind: "socket",
    run: async (input) => {
      const v = await getSharedLightspeed().lookup(target(input).host);
      return { blocked: !!v.blocked, category: v.category };
    },
  },

  {
    name: "FortiGuard",
    short: "FG",
    description: "FortiGuard Web Filter — via server proxy",
    kind: "server",
    run: async (input) => {
      const r = await serverCheck<{ data?: unknown[] }>("fortiguard", target(input).full);
      const names: string[] = [];
      let blocked = false;
      for (const cat of r.data ?? []) {
        const info = FG_CATS[String(cat)] ?? { category: "Unknown", blocked: true };
        names.push(info.category);
        if (!blocked) blocked = info.blocked;
      }
      return { category: names.join(", "), blocked };
    },
  },

  {
    name: "Blocksi Web",
    short: "BW",
    description: "Blocksi web database rating — direct (CORS OK)",
    kind: "native",
    run: async (input) => {
      const r = await blocksiStandard(target(input).full);
      if (isErr(r)) throw new Error("blocksi web error");
      return { category: asText(r), blocked: !!r[1] };
    },
  },

  {
    name: "Blocksi AI",
    short: "BA",
    description: "Blocksi AI LLM classifier — direct (CORS OK)",
    kind: "native",
    run: async (input) => {
      const r = await blocksiAI(target(input).full);
      if (isErr(r)) throw new Error("blocksi ai error");
      return { category: asText(r), blocked: !!r[1] };
    },
  },

  {
    name: "Linewize",
    short: "LW",
    description: "Linewize Classwize gateway — via server proxy",
    kind: "server",
    run: async (input) => {
      const r = await serverCheck<{
        signatures?: { category?: string; subCategory?: string };
      }>("linewize", target(input).full);
      const clean = (s?: string) =>
        s?.replaceAll("sphirewall.application.", "").replaceAll("sphirewall.category.", "");
      const subCategory = clean(r.signatures?.subCategory) ?? "Not rated";
      const category = clean(r.signatures?.category);
      const blockedCats = [
        "animeandmanga", "dynamicdns", "trackers", "celebrities", "entertainment",
        "humouranddistractions", "livestreaming", "media", "socialmediaandcommunication",
        "marijuana", "crypto", "gamestorespublishers", "videogames", "blocklist.proxies",
        "aitools", "blocklist.dating", "blocklist.piracy", "whatsmyipservices", "p2p",
        "unsafesearchengines", "porn", "extreme", "malware", "matureandexplicit",
        "gamingresources", "offensive",
      ];
      let blocked = blockedCats.includes(category ?? "") || blockedCats.includes(subCategory);
      if (subCategory === "Not rated") blocked = false;
      return {
        category: subCategory,
        blocked: subCategory.startsWith("blocklist.") ? true : blocked,
      };
    },
  },

  {
    name: "Deledao",
    short: "DD",
    description: "Deledao ActivePulse — direct (CORS OK)",
    kind: "native",
    run: async (input) => {
      // Domain-categorization API; path adds nothing reliable → host only.
      const r = await deledao(target(input).host);
      if (isErr(r)) throw new Error("deledao error");
      return { category: asText(r), blocked: !!r[1] };
    },
  },

  {
    name: "Senso Cloud",
    short: "SC",
    description: "Senso.cloud filtering lookup — via server proxy",
    kind: "server",
    run: async (input) => {
      const r = await serverCheck<unknown[]>("senso", target(input).hostPath);
      // Senso returns a bare array of category ids; map through the vendored table.
      let cats = ".";
      let blocked = false;
      for (const cat of r) {
        const info = SENSO_CATS[String(cat)];
        if (info) {
          if (cats === ".") cats = info[0];
          else cats = cats + (cats === "" ? "" : ", ") + info[0];
          blocked = blocked || info[1];
        }
      }
      if (cats === ".") return { category: "Uncategorized", blocked: true };
      return { category: cats === "" ? "Uncategorized" : cats, blocked };
    },
  },

  {
    name: "Sophos",
    short: "SO",
    description: "Sophos SXL4 categorization — binary protobuf, direct POST",
    kind: "native",
    run: async (input) => {
      // SXL4 speaks binary protobuf with CORS headers — works straight from
      // the browser via the vendored encoder/decoder in vendor/sophos.ts.
      const r = await sophos(target(input).full);
      if (!r.found) return { category: "Uncategorized", blocked: false };
      const blocked =
        !!r.isThreat ||
        (r.riskLevelNum ?? 0) >= 4 ||
        !SOPHOS_ALLOWED_PROD.has(r.productivityCategoryNum ?? 0);
      return {
        category: (r.productivityCategory ?? "UNCATEGORIZED") + (r.isThreat ? ` / ${r.threat}` : ""),
        blocked,
      };
    },
  },

  {
    name: "Barracuda",
    short: "BR",
    description: "Barracuda WebFilter reputation — via server proxy",
    kind: "server",
    run: async (input) => {
      return serverCheck<{ category: string; blocked: boolean }>("barracuda", target(input).host, true);
    },
  },

  // ── DNS-level resolvers (always work, direct from the browser) ─────────────

  cloudflareSecurity,
  cloudflareFamily,
  cleanbrowsingSecurity,
  cleanbrowsingFamily,
  opendnsFamilyShield,
];

/** Check one URL against every filter — same contract as the registry script. */
export async function checkUrl(url: string): Promise<FilterResult[]> {
  return Promise.all(
    FILTERS.map(async (f): Promise<FilterResult> => {
      try {
        const r = await f.run(url);
        const blocked = typeof r === "object" && r !== null ? !!(r as { blocked?: boolean }).blocked : !!r;
        return { name: f.name, blocked };
      } catch (e) {
        return { name: f.name, blocked: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
