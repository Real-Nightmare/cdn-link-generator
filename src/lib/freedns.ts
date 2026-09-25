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

/** Public CORS relays (GET-only proxies) — same ones the Filter Checker uses. */
const RELAY_TIMEOUT_MS = 20_000;
async function publicRelayText(url: string, timeoutMs = RELAY_TIMEOUT_MS): Promise<string> {
  const attempts: Array<() => Promise<string>> = [
    () =>
      fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(timeoutMs) }).then((res) => {
        if (!res.ok) throw new Error(`public relay ${res.status}`);
        return res.text();
      }),
    () =>
      fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
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
    const qs = new URLSearchParams({ page: "1", sort: String(sort) });
    if (query) qs.set("q", query);
    let fetchPage = page;
    if (least) {
      const first = parseRegistryHtml(await publicRelayText(`${FREEDNS_PUBLIC_PAGE}?${qs.toString()}`));
      fetchPage = Math.max(1, first.pages - page + 1);
      qs.set("page", String(fetchPage));
    } else {
      qs.set("page", String(page));
    }
    const parsed = parseRegistryHtml(await publicRelayText(`${FREEDNS_PUBLIC_PAGE}?${qs.toString()}`));
    return {
      total: parsed.total,
      pages: parsed.pages,
      page: fetchPage,
      least,
      domains: parsed.domains,
      via: "public",
    };
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
    const body = (await publicRelayText(target, 30_000)).trim().slice(0, 200);
    const ok = args.provider === "duckdns" ? body.toUpperCase().startsWith("OK") : /^200/i.test(body) || /^good/i.test(body);
    if (!ok) throw new Error(`${args.provider} refused via public relay: ${body || "(empty reply)"}`);
    return { ok: true, provider: args.provider, host: hostOut, ip: args.ip ?? "", reply: body };
  },
};
