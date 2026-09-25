// FreeDNS automation client — talks to api/freedns.py (same relay pattern as
// the Filter Checker's /api/filter). Server absence falls back to nothing:
// the panel shows the relay status, manual BYOD entry always works.

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

/** Raw relay call. Throws with the relay's error text. */
async function call<T>(params: Record<string, string>, timeoutMs = 45_000): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${FREEDNS_API}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
  // A 200 with HTML (SPA index) means the relay isn't deployed on this host.
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok && !ct.includes("application/json")) {
    throw new Error("FreeDNS relay not available on this host (api/freedns.py not deployed)");
  }
  const j = (await res.json().catch(() => null)) as { error?: string } & T | null;
  if (!j) throw new Error("FreeDNS relay not available on this host (api/freedns.py not deployed)");
  if (j.error) throw new Error(j.error);
  return j;
}

/** png → <img src> data URL. */
function pngDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

export const freedns = {
  ping(): Promise<boolean> {
    return call<{ ok: boolean }>({ kind: "ping" }, 12_000)
      .then((r) => !!r.ok)
      .catch(() => false);
  },

  /** The browser's own public IP — default destination for the A record. */
  webip(): Promise<string> {
    return call<{ ip: string }>({ kind: "webip" }, 12_000).then((r) => r.ip ?? "");
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

  registry(
    sid: string,
    page: number,
    query: string,
    opts?: { sort?: number; least?: boolean },
  ): Promise<{ total: number; pages: number; page: number; least: boolean; domains: FreednsDomain[] }> {
    return call<{ total: number; pages: number; page: number; least: boolean; domains: FreednsDomain[] }>({
      kind: "registry",
      sid,
      page: String(page),
      query,
      sort: String(opts?.sort ?? 5),
      least: opts?.least ? "1" : "0",
    });
  },

  /** Point a dynamic-DNS hostname (DuckDNS, dynv6, Dynu, No-IP, ChangeIP,
   * deSEC) at an IP through the relay — those endpoints send no CORS headers,
   * so the browser can't reach them directly. Stateless: no sid needed.
   * `ip: ""` lets the relay default to the requester's public IP. */
  dyndns(args: {
    provider: "duckdns" | "dynv6" | "dynu" | "noip" | "changeip" | "desec";
    host: string;
    ip?: string;
    token?: string;
    user?: string;
    pass?: string;
  }): Promise<{ ok: boolean; provider: string; host: string; ip: string; reply: string }> {
    return call<{ ok: boolean; provider: string; host: string; ip: string; reply: string }>({
      kind: "dyndns",
      provider: args.provider,
      host: args.host,
      ip: args.ip ?? "",
      token: args.token ?? "",
      user: args.user ?? "",
      pass: args.pass ?? "",
    });
  },

  /** Create the record that puts the IP on the internet:
   * `sub.<domain>` A <ip> — the exact host the BYOD box wants. */
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
};
