// FreeDNS automation client — talks to api/freedns.py (same relay pattern as
// the Filter Checker's /api/filter).
//
// Relay tiers (mirrors how the Filter Checker survives static hosts):
//   1. same-origin /api/freedns     — the deployed Python relay
//   2. custom relay URL (settings)  — api/freedns.py self-hosted anywhere
//                                     (python3 api/freedns.py on your own box)
//   3. public CORS relays           — for the SESSIONLESS ops only:
//                                     registry browsing (public page + a
//                                     client-side parser) and DuckDNS /
//                                     ChangeIP updates (pure-GET APIs).
// Ops that need the FreeDNS session (captcha/signup/login/create/records)
// require tier 1 or 2 — the panel says so and manual BYOD entry still works.

export interface FreednsSession {
  /** Relay-side FreeDNS session id. */
  sid: string;
  user: string;
  pass: string;
  /** Temp-mail session (signup flow only). */
  msid?: string;
  /** The temp address the account was created with. */
  email?: string;
}

export interface FreednsDomain {
  domain: string;
  id: number;
  hosts: number;
  status: string;
}

export interface FreednsRecord {
  id: string;
  subdomain: string;
  type: string;
  destination: string;
}

export type FreednsStep =
  | "idle"
  | "captcha"
  | "solve"
  | "signup"
  | "mail"
  | "login"
  | "registry"
  | "ready"
  | "create"
  | "done";

export const FREEDNS_API = "/api/freedns";
export const FREEDNS_PUBLIC_PAGE = "https://freedns.afraid.org/domain/registry/";

/** localStorage key for a user-supplied relay base (self-hosted api/freedns.py). */
const CUSTOM_RELAY_KEY = "cdn-studio-freedns-relay";

export function customRelayBase(): string {
  try {
    return localStorage.getItem(CUSTOM_RELAY_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setCustomRelayBase(v: string): void {
  try {
    const t = v.trim().replace(/\/+$/, "");
    if (t) localStorage.setItem(CUSTOM_RELAY_KEY, t);
    else localStorage.removeItem(CUSTOM_RELAY_KEY);
  } catch {
    /* private mode — relay setting just won't persist */
  }
}

/** Relay bases to try, in order: custom first, then same-origin. */
function relayBases(): string[] {
  const custom = customRelayBase();
  return custom ? [custom, FREEDNS_API] : [FREEDNS_API];
}

/** Public CORS relays (GET-only proxies) — same ones the Filter Checker uses.
 * Both proxy the raw bytes (the registry's HTML, or the plain dyndns2 reply).
 * Live-checked 2026-09: they occasionally 522 together (Cloudflare blip —
 * retry later); the registry browser then falls back to r.jina.ai's markdown
 * rendering instead (see parseRegistryMarkdown), and dyndns ops surface a
 * clear "proxies are down" error. */
const RELAY_TIMEOUT_MS = 8_000; // per attempt — dead proxies must not stall the panel
async function publicRelayRaw(url: string, timeoutMs = RELAY_TIMEOUT_MS): Promise<string> {
  const attempts: Array<() => Promise<string>> = [
    () =>
      fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      }).then((res) => {
        if (!res.ok) throw new Error(`public relay ${res.status}`);
        return res.text();
      }),
    () =>
      fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      }).then((res) => {
        if (!res.ok) throw new Error(`public relay ${res.status}`);
        return res.text();
      }),
  ];
  let lastErr: unknown;
  for (const start of attempts) {
    try {
      return await start();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all public relays failed");
}

/** r.jina.ai's readable-text rendering — the registry rows survive as markdown
 * links, so browsing still works when the raw proxies are down (live-checked:
 * 100 rows/page, `Page 1 of 209` in the title carries the page count). */
async function publicRelayJinaMarkdown(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`public relay jina ${res.status}`);
  return res.text();
}

/** png → <img src> data URL. */
function pngDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

/** A relay ANSWERED with an application error — surface it, don't retry. */
class RelayError extends Error {}

const NO_RELAY_HINT =
  "no FreeDNS relay reachable — deploy api/freedns.py alongside the site, run it on your own box (python3 api/freedns.py) and set its URL in the ⚡ panel, or use the public registry browser";

/** Raw relay call through tier 1/2. Throws with the relay's error text. */
async function call<T>(params: Record<string, string>, timeoutMs = 45_000): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  let lastErr: unknown = null;
  for (const base of relayBases()) {
    try {
      const res = await fetch(`${base}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
      const ct = res.headers.get("content-type") ?? "";
      // A 200 with HTML (SPA index) means this base isn't a relay — try the next.
      if (!ct.includes("application/json")) {
        lastErr = new Error(NO_RELAY_HINT);
        continue;
      }
      const j = (await res.json().catch(() => null)) as { error?: string } & T | null;
      if (!j) {
        lastErr = new Error(NO_RELAY_HINT);
        continue;
      }
      // A real relay answered — surface its error, don't retry other bases.
      if (j.error) throw new RelayError(j.error);
      return j;
    } catch (e) {
      if (e instanceof RelayError) throw e;
      // Infrastructure failures (network, timeout, bad JSON) try the next base.
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(NO_RELAY_HINT);
}

/** Which relay base (if any) answers kind=ping — "" when none do. */
async function pingBase(): Promise<string> {
  for (const base of relayBases()) {
    try {
      const res = await fetch(`${base}?kind=ping`, { signal: AbortSignal.timeout(12_000) });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("application/json")) {
        const j = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (j?.ok) return base;
      }
    } catch {
      /* try the next base */
    }
  }
  return "";
}

// ── client-side registry parsing (the public page needs no session) ─────────

function decodeHtml(s: string): string {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

/** Port of api/freedns.py:_parse_registry — tolerates FreeDNS's UNQUOTED
 * attributes and the <font color=red> match highlighting in q= searches. */
export function parseRegistryHtml(page: string): { total: number; pages: number; domains: FreednsDomain[] } {
  const domains: FreednsDomain[] = [];
  for (const m of page.matchAll(/<tr class="?tr[ld]"?>[\s\S]*?<\/tr>/gi)) {
    const row = m[0];
    const idm = row.match(/edit_domain_id=(\d+)[^>]*>([\s\S]*?)<\/a>/i);
    if (!idm) continue;
    // Tags → empty (not space): 'mooo</font>.com' must become 'mooo.com'.
    const name = decodeHtml(idm[2].replace(/<[^>]+>/g, "")).trim();
    if (!name) continue;
    const text = decodeHtml(row.replace(/<[^>]+>/g, " "));
    const hm = text.match(/\(([\d,]+)\s+hosts?/);
    const sm = row.match(/<td>\s*(public|private)\s*<\/td>/i);
    domains.push({
      domain: name,
      id: parseInt(idm[1], 10),
      hosts: hm ? parseInt(hm[1].replace(/,/g, ""), 10) : 0,
      status: sm ? sm[1].toLowerCase() : "",
    });
  }
  let total = 0;
  const mi = page.indexOf("Showing");
  if (mi !== -1) {
    const frag = decodeHtml(page.slice(mi, mi + 300).replace(/<[^>]+>/g, " "));
    const tm = frag.match(/Showing\s*[\d,]+\s*-\s*[\d,]+\s*of\s*([\d,]+)\s*total/);
    if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10);
  }
  return { total, pages: total ? Math.max(1, Math.ceil(total / 100)) : 1, domains };
}

/** Companion parser for r.jina.ai's markdown rendering of the registry page
 * (used when the raw-HTML proxies are down). The domain rows survive as
 * `[name](https://freedns.afraid.org/subdomain/edit.php?edit_domain_id=N)`
 * links followed by the `(N hosts in use)` / `public|private` cells; the page
 * count comes from the `Title: Domain Registry : Page X of Y` line. */
export function parseRegistryMarkdown(md: string): { total: number; pages: number; domains: FreednsDomain[] } {
  const links: Array<{ name: string; id: number; start: number; end: number }> = [];
  for (const m of md.matchAll(/\[([^\]]+)\]\([^)]*edit_domain_id=(\d+)[^)]*\)/gi)) {
    links.push({ name: m[1], id: parseInt(m[2], 10), start: m.index, end: m.index + m[0].length });
  }
  const domains: FreednsDomain[] = [];
  for (let i = 0; i < links.length; i++) {
    // Markdown emphasis from FreeDNS's red match highlight (**mooo**.com) and
    // any stray entity — strip to the bare domain, then require domain shape.
    const name = decodeHtml(links[i].name.replace(/[*_`]/g, "")).trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) continue;
    // Cells for this row live between this link and the next row's link.
    const stop = i + 1 < links.length ? links[i + 1].start : Math.min(md.length, links[i].end + 400);
    const text = md.slice(links[i].end, stop).replace(/\[[^\]]*\]\([^)]*\)/g, " ");
    const hm = text.match(/\(([\d,]+)\s+hosts?/);
    const sm = text.match(/\b(public|private)\b/i);
    domains.push({
      domain: name,
      id: links[i].id,
      hosts: hm ? parseInt(hm[1].replace(/,/g, ""), 10) : 0,
      status: sm ? sm[1].toLowerCase() : "",
    });
  }
  let pages = 0;
  const pm = md.match(/Page\s+\d+\s+of\s+(\d+)/i);
  if (pm) pages = parseInt(pm[1], 10);
  let total = 0;
  const tm = md.match(/Showing\s*[\d,]+\s*-\s*[\d,]+\s*of\s*([\d,]+)\s*total/i);
  if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10);
  if (!total && pages) total = pages * 100; // close enough for the counter chip
  if (!pages && total) pages = Math.max(1, Math.ceil(total / 100));
  return { total, pages: pages || 1, domains };
}

export interface RegistryResult {
  total: number;
  pages: number;
  page: number;
  least: boolean;
  domains: FreednsDomain[];
  /** "relay" = served by api/freedns.py · "public" = scraped via public CORS relay. */
  via: "relay" | "public";
}

export const freedns = {
  /** True when a tier-1/2 relay answers (full automation available). */
  ping(): Promise<boolean> {
    return pingBase().then((b) => !!b);
  },

  /** The working relay base — "" when none (public fallbacks still available). */
  pingBase(): Promise<string> {
    return pingBase();
  },

  /** The browser's own public IP — default destination for the A record.
   * Falls back to api.ipify.org directly when no relay is reachable. */
  async webip(): Promise<string> {
    try {
      const r = await call<{ ip: string }>({ kind: "webip" }, 12_000);
      if (r.ip) return r.ip;
    } catch {
      /* fall through to the CORS-open IP echo */
    }
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { ip?: string };
    return j.ip ?? "";
  },

  captcha(sid?: string): Promise<{ sid: string; image: string }> {
    return call<{ sid: string; b64: string }>(sid ? { kind: "captcha", sid } : { kind: "captcha" }).then((r) => ({
      sid: r.sid,
      image: pngDataUrl(r.b64),
    }));
  },

  newmail(): Promise<{ email: string; msid: string }> {
    return call<{ email: string; msid: string }>({ kind: "newmail" });
  },

  signup(args: {
    sid: string;
    user: string;
    pass: string;
    email: string;
    captcha: string;
    first?: string;
    last?: string;
  }): Promise<void> {
    return call<void>({
      kind: "signup",
      sid: args.sid,
      user: args.user,
      pass: args.pass,
      email: args.email,
      captcha: args.captcha,
      first: args.first || "Studio",
      last: "User",
    }).then(() => undefined);
  },

  /** Manual activation (user pasted the code from their own inbox). */
  activate(code: string): Promise<void> {
    return call<void>({ kind: "activate", code }).then(() => undefined);
  },

  /** One-shot temp-inbox poll: has the FreeDNS activation mail arrived yet?
   * The signup UI loops this (live countdown, cancellable) instead of parking
   * on the blocking autoactivate request for minutes. */
  mailcheck(msid: string, sid?: string): Promise<{ found: boolean; code: string }> {
    return call<{ found: boolean; code?: string }>(
      sid ? { kind: "mailcheck", msid, sid } : { kind: "mailcheck", msid },
    ).then((r) => ({ found: !!r.found, code: r.code || "" }));
  },

  /** Auto-activate: wait for the FreeDNS mail in the temp inbox, open it. */
  autoactivate(sid: string, msid: string): Promise<void> {
    return call<void>({ kind: "autoactivate", sid, msid }, 180_000).then(() => undefined);
  },

  login(sid: string, user: string, pass: string): Promise<void> {
    return call<void>({ kind: "login", sid, user, pass }).then(() => undefined);
  },

  /** Registry via the logged-in relay session. */
  registry(
    sid: string,
    page: number,
    query: string,
    opts?: { sort?: number; least?: boolean },
  ): Promise<RegistryResult> {
    return call<{ total: number; pages: number; page: number; least: boolean; domains: FreednsDomain[] }>({
      kind: "registry",
      sid,
      page: String(page),
      query,
      sort: String(opts?.sort ?? 5),
      least: opts?.least ? "1" : "0",
    }).then((r) => ({ ...r, via: "relay" as const }));
  },

  /** Public registry browsing — no FreeDNS login needed. Tries the relay's
   * sessionless registrybrowse op first, then scrapes the public page through
   * a CORS-open relay and parses it client-side. */
  async registryBrowse(page: number, query: string, opts?: { sort?: number; least?: boolean }): Promise<RegistryResult> {
    const sort = opts?.sort ?? 5;
    const least = !!opts?.least;
    try {
      const r = await call<{ total: number; pages: number; page: number; least: boolean; domains: FreednsDomain[] }>(
        { kind: "registrybrowse", page: String(page), query, sort: String(sort), least: least ? "1" : "0" },
        25_000,
      );
      return { ...r, via: "relay" as const };
    } catch {
      /* fall through to the public scrape */
    }
    // Public page under sort=5 runs most→least popular; least-mode maps to the
    // tail pages exactly like the relay does (page 1 of the reversed count =
    // the registry's last page).
    const base = new URLSearchParams({ sort: String(sort) });
    if (query) base.set("q", query);
    const fetchPublic = async (p: number) => {
      const qs = new URLSearchParams(base);
      qs.set("page", String(p));
      const target = `${FREEDNS_PUBLIC_PAGE}?${qs.toString()}`;
      // Raw-HTML proxies first (exact parse), then jina's markdown rendering.
      try {
        const parsed = parseRegistryHtml(await publicRelayRaw(target));
        if (parsed.domains.length > 0) return parsed;
      } catch {
        /* raw proxies down — fall through to the markdown renderer */
      }
      return parseRegistryMarkdown(await publicRelayJinaMarkdown(target));
    };
    if (least) {
      const first = await fetchPublic(1);
      const fetchPage = Math.max(1, first.pages - page + 1);
      const tail = await fetchPublic(fetchPage);
      return { total: tail.total, pages: tail.pages, page: fetchPage, least, domains: tail.domains, via: "public" };
    }
    const parsed = await fetchPublic(page);
    return { total: parsed.total, pages: parsed.pages, page, least: false, domains: parsed.domains, via: "public" };
  },

  /** Create the record that puts the IP on the internet:
   * `sub.<domain>` A <ip> — the exact host the BYOD box wants. (Relay-only:
   * needs the logged-in session.) */
  createRecord(args: {
    sid: string;
    type: "A" | "AAAA" | "CNAME";
    sub: string;
    domainId: string;
    dest: string;
    captcha: string;
  }): Promise<{ created: string }> {
    return call<{ created: string }>({
      kind: "create",
      sid: args.sid,
      type: args.type,
      sub: args.sub,
      did: args.domainId,
      dest: args.dest,
      captcha: args.captcha,
    });
  },

  records(sid: string): Promise<{ records: FreednsRecord[] }> {
    return call<{ records: FreednsRecord[] }>({ kind: "records", sid });
  },

  /** Repoint an existing A record at a new IP (updates the BYOD host). */
  updateRecord(args: { sid: string; id: string; type?: string; dest?: string; captcha: string }): Promise<void> {
    return call<void>({ kind: "update", sid: args.sid, id: args.id, type: args.type ?? "", dest: args.dest ?? "", captcha: args.captcha }).then(
      () => undefined,
    );
  },

  /** Point a dynamic-DNS hostname (DuckDNS, dynv6, Dynu, No-IP, ChangeIP,
   * deSEC) at an IP. Those endpoints send no CORS headers, so this needs the
   * relay — EXCEPT DuckDNS and ChangeIP, whose updates are pure GETs and also
   * work through the public CORS relays on static hosts.
   * `ip: ""` lets the relay default to the requester's public IP. */
  async dyndns(args: {
    provider: "duckdns" | "dynv6" | "dynu" | "noip" | "changeip" | "desec";
    host: string;
    ip?: string;
    token?: string;
    user?: string;
    pass?: string;
  }): Promise<{ ok: boolean; provider: string; host: string; ip: string; reply: string }> {
    try {
      return await call<{ ok: boolean; provider: string; host: string; ip: string; reply: string }>({
        kind: "dyndns",
        provider: args.provider,
        host: args.host,
        ip: args.ip ?? "",
        token: args.token ?? "",
        user: args.user ?? "",
        pass: args.pass ?? "",
      });
    } catch (e) {
      // Public-relay fallbacks for the two pure-GET providers. If a relay
      // answered with a provider error (not infrastructure), rethrow it.
      if (e instanceof RelayError) throw e;
      if (args.provider !== "duckdns" && args.provider !== "changeip") {
        throw new Error(
          `${args.provider} updates need the api/freedns.py relay (deploy it, or run it on your own box and set the URL in the ⚡ panel) — only DuckDNS and ChangeIP work without one`,
        );
      }
      // duckdns/changeip: their update APIs are pure GETs, so the public CORS
      // relays carry them — but only the raw-byte proxies (jina refuses
      // plain-text targets). If those two happen to be down, say so.
    }
    // duckdns: label (not FQDN) + token; changeip: creds in the query.
    let target: string;
    let hostOut = args.host.trim().toLowerCase();
    if (args.provider === "duckdns") {
      const label = hostOut.split(".")[0];
      target =
        `https://www.duckdns.org/update?domains=${encodeURIComponent(label)}` +
        `&token=${encodeURIComponent(args.token ?? "")}` +
        `&ip=${encodeURIComponent(args.ip ?? "")}&verbose=true`;
    } else {
      target =
        `https://nic.changeip.com/nic/update?u=${encodeURIComponent(args.user ?? "")}` +
        `&p=${encodeURIComponent(args.pass ?? "")}` +
        `&hostname=${encodeURIComponent(hostOut)}` +
        `&myip=${encodeURIComponent(args.ip ?? "")}`;
    }
    let body: string;
    try {
      body = (await publicRelayRaw(target, 12_000)).trim().slice(0, 200);
    } catch (e) {
      throw new Error(
        `${args.provider} update through the public relays failed (${e instanceof Error ? e.message : "unknown"}) — the public proxies are down or rate-limited right now; retry shortly or set a self-hosted relay in the ⚡ panel`,
      );
    }
    const ok = args.provider === "duckdns" ? body.toUpperCase().startsWith("OK") : /^200/i.test(body) || /^good/i.test(body);
    if (!ok) throw new Error(`${args.provider} refused via public relay: ${body || "(empty reply)"}`);
    return { ok: true, provider: args.provider, host: hostOut, ip: args.ip ?? "", reply: body };
  },
};
