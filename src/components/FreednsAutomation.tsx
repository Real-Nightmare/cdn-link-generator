// In-app FreeDNS automation — brings domain92 (github.com/sebastian-92/domain92,
// powered by ading2210's freedns-client) into the Studio's BYOD section.
//
// What domain92 does, now wired to the app's BYOD box:
//   1. solve a freedns.afraid.org captcha → 2. create a FreeDNS account
//   (temp guerrillamail inbox as the signup email) → 3. the relay receives the
//   activation mail and opens the link automatically → 4. log in, browse the
//   public domain registry (21k+ shared domains: mooo.com, chickenkiller.com…)
//   → 5. create `name.<domain> A <your IP>` — that record IS the BYOD host:
//   paste it into the BYOD box and every asset × commit gains a link on it.
//
// The relay (api/freedns.py, stdlib-only) does the talking — FreeDNS sends no
// CORS headers, so the browser can't hit it directly. Existing-account users
// log in directly; a login captcha is handled inline. Existing records can be
// repointed at a new IP (dyn-DNS style) with one captcha.

import { useCallback, useEffect, useRef, useState } from "react";
import { customRelayBase, freedns, setCustomRelayBase, FreednsDomain, FreednsRecord } from "../lib/freedns";

type Stage = "idle" | "signup" | "login" | "registry" | "records";

function copyText(t: string): void {
  try {
    void navigator.clipboard.writeText(t);
  } catch {
    /* the text is visible anyway */
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Strip scheme/path from a user-typed destination; keep the host or IP. */
function cleanDest(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split("/")[0]
    .trim();
}

export function FreednsAutomation({ onAdopt }: { onAdopt: (host: string) => void }) {
  const [open, setOpen] = useState(false);
  const [relayUp, setRelayUp] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // signup flow state
  const [sid, setSid] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // registry / records state
  const [domains, setDomains] = useState<FreednsDomain[]>([]);
  const [regPage, setRegPage] = useState(1);
  const [regTotal, setRegTotal] = useState(0);
  const [regQuery, setRegQuery] = useState("");
  /** true = count pages from the LEAST-popular end (tail of FreeDNS's
   * popularity sort) — tiny shared domains, freshest subdomains first. */
  const [regLeast, setRegLeast] = useState(false);
  const [pickedDomain, setPickedDomain] = useState<FreednsDomain | null>(null);
  const [subName, setSubName] = useState("");
  const [recordType, setRecordType] = useState<"A" | "AAAA" | "CNAME">("A");
  const [dest, setDest] = useState("");
  const [records, setRecords] = useState<FreednsRecord[]>([]);
  const [creds, setCreds] = useState<{ user: string; pass: string; sid: string } | null>(null);
  const autoFilledIp = useRef(false);

  // self-hosted relay + public registry browse (the no-relay fallbacks)
  const [relayInput, setRelayInput] = useState(customRelayBase);
  const [pubOpen, setPubOpen] = useState(false);
  const [pubDomains, setPubDomains] = useState<FreednsDomain[]>([]);
  const [pubPage, setPubPage] = useState(1);
  const [pubTotal, setPubTotal] = useState(0);
  const [pubQuery, setPubQuery] = useState("");
  const [pubLeast, setPubLeast] = useState(false);
  const [pubVia, setPubVia] = useState<"relay" | "public">("relay");
  const [pickedPub, setPickedPub] = useState<FreednsDomain | null>(null);
  const [manualSub, setManualSub] = useState("");

  useEffect(() => {
    if (!open || relayUp !== null) return;
    let on = true;
    setBusy("Checking for a FreeDNS relay…");
    freedns
      .pingBase()
      .then((base) => {
        if (on) {
          setRelayUp(!!base);
          setBusy(null);
        }
      })
      .catch(() => {
        if (on) {
          setRelayUp(false);
          setBusy(null);
        }
      });
    return () => {
      on = false;
    };
  }, [open, relayUp]);

  // Pre-fill the destination with the browser's own public IP once.
  useEffect(() => {
    if (!open || stage !== "registry" || autoFilledIp.current) return;
    autoFilledIp.current = true;
    freedns
      .webip()
      .then((ip) => {
        if (ip) setDest((d) => d || ip);
      })
      .catch(() => {});
  }, [open, stage]);

  const solveCaptcha = useCallback(async (forSid?: string) => {
    setBusy("Loading captcha…");
    setError(null);
    try {
      const c = await freedns.captcha(forSid || undefined);
      setSid(c.sid);
      setCaptchaImg(c.image);
      setCaptchaCode("");
      setStage(forSid ? "records" : "signup");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  async function doSignup() {
    if (!sid || !captchaCode.trim() || !username.trim() || !password || busy) return;
    setBusy("Creating temp inbox…");
    setError(null);
    try {
      const mail = await freedns.newmail();
      setTempEmail(mail.email);
      setBusy("Signing up on freedns.afraid.org…");
      await freedns.signup({
        sid,
        user: username.trim(),
        pass: password,
        email: mail.email,
        captcha: captchaCode.trim(),
      });
      setBusy("Waiting for the activation mail (opens automatically)…");
      await freedns.autoactivate(sid, mail.msid);
      setBusy("Logging in…");
      await freedns.login(sid, username.trim(), password);
      setCreds({ user: username.trim(), pass: password, sid });
      await loadRegistry(sid, 1, "", regLeast);
      setStage("registry");
      setCaptchaImg("");
      setCaptchaCode("");
    } catch (e) {
      setError(errMsg(e));
      // Wrong captcha is the common failure — offer a fresh one in place.
      void solveCaptcha(stage === "records" ? sid : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function doLogin() {
    if (!sid || !captchaCode.trim() || !username.trim() || !password || busy) return;
    setBusy("Logging in…");
    setError(null);
    try {
      await freedns.login(sid, username.trim(), password);
      setCreds({ user: username.trim(), pass: password, sid });
      await loadRegistry(sid, 1, "", regLeast);
      setStage("registry");
      setCaptchaImg("");
      setCaptchaCode("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const loadRegistry = useCallback(async (useSid: string, page: number, query = "", least = false) => {
    setBusy(least ? "Loading the least-used domains…" : query ? "Searching the registry…" : "Loading the domain registry…");
    setError(null);
    try {
      const r = await freedns.registry(useSid, page, query, { least });
      setDomains(r.domains);
      setRegPage(page);
      setRegTotal(r.total);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  /** Public registry browse — works with zero relay (relay's sessionless
   * registrybrowse op first, then a public CORS relay + client-side parse). */
  const loadPub = useCallback(async (page: number, query = "", least = false) => {
    setBusy(least ? "Loading the least-used public domains…" : query ? "Searching the public registry…" : "Loading the public registry…");
    setError(null);
    try {
      const r = await freedns.registryBrowse(page, query, { least });
      setPubDomains(r.domains);
      setPubPage(page);
      setPubTotal(r.total);
      setPubVia(r.via);
    } catch (e) {
      setError(`public registry: ${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Save a self-hosted relay URL and re-check it. */
  function applyRelay() {
    setCustomRelayBase(relayInput);
    setRelayUp(null); // the ping effect re-runs against the new base
  }

  async function loadRecords(useSid: string) {
    setBusy("Loading your records…");
    setError(null);
    try {
      const r = await freedns.records(useSid);
      setRecords(r.records);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function doCreate() {
    if (!creds || !pickedDomain || !subName.trim() || !cleanDest(dest) || busy) return;
    if (!captchaCode.trim()) {
      setError("FreeDNS requires a captcha for this too — solve the one below.");
      void solveCaptcha(creds.sid);
      return;
    }
    setBusy(`Creating ${subName.trim()}.${pickedDomain.domain} → ${cleanDest(dest)}…`);
    setError(null);
    try {
      const r = await freedns.createRecord({
        sid: creds.sid,
        type: recordType,
        sub: subName.trim(),
        domainId: String(pickedDomain.id),
        dest: cleanDest(dest),
        captcha: captchaCode.trim(),
      });
      const host = r.created || `${subName.trim()}.${pickedDomain.domain}`;
      onAdopt(host);
      setPickedDomain(null);
      setSubName("");
      setCaptchaCode("");
      setCaptchaImg("");
      await loadRecords(creds.sid);
    } catch (e) {
      setError(errMsg(e));
      setCaptchaCode("");
      void solveCaptcha(creds.sid); // captchas are single-use — refresh
    } finally {
      setBusy(null);
    }
  }

  async function doRepoint(rec: FreednsRecord) {
    if (!creds || busy) return;
    const target = cleanDest(dest);
    if (!target || target === rec.destination) return;
    if (!captchaCode.trim()) {
      setError("Solve the captcha below first — FreeDNS gates every record change.");
      void solveCaptcha(creds.sid);
      return;
    }
    setBusy(`Repointing ${rec.subdomain} → ${target}…`);
    setError(null);
    try {
      await freedns.updateRecord({
        sid: creds.sid,
        id: rec.id,
        type: rec.type,
        dest: target,
        captcha: captchaCode.trim(),
      });
      setCaptchaCode("");
      setCaptchaImg("");
      await loadRecords(creds.sid);
      onAdopt(rec.subdomain); // already in the box? adoption is a no-op then
    } catch (e) {
      setError(errMsg(e));
      void solveCaptcha(creds.sid);
    } finally {
      setBusy(null);
    }
  }

  const canTrySignup = relayUp !== false;

  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-ink-900/40 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        title="domain92-style FreeDNS automation: create the account, pick a domain, point a record at your IP"
      >
        <span className="text-sm">⚡</span>
        <span className="text-xs font-semibold text-slate-200">
          Automate FreeDNS (afraid.org) — domain92 style
        </span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Exactly what <span className="font-mono text-slate-400">domain92</span> does: create a
            FreeDNS account (temp inbox, captcha's the only manual step), pick a shared domain like{" "}
            <span className="font-mono text-slate-400">mooo.com</span>, and create{" "}
            <span className="font-mono text-slate-400">yourname A &lt;your IP&gt;</span> — the record
            lands straight in the BYOD box above, so links come out on it. Sort the registry{" "}
            <span className="text-accent-soft">least popular</span> to start at domains with only a
            handful of hosts — those subdomains are the least burned.
            {relayUp === false && (
              <span className="ml-1 text-warn">
                The relay (api/freedns.py) isn't reachable on this host — manual BYOD entry still
                works, and the options below cover the rest.
              </span>
            )}
          </p>

          {error && <p className="text-[11px] text-danger">✗ {error}</p>}
          {busy && <p className="text-[11px] text-accent">{busy}</p>}

          {relayUp === false && (
            <div className="space-y-2 rounded-md border border-warn/30 bg-warn/5 p-2.5">
              <p className="text-[11px] leading-relaxed text-warn">
                This deploy is static-only (no server-side Python), so full automation needs a
                reachable relay:
              </p>
              <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-slate-400">
                <li>
                  <span className="font-semibold text-slate-300">Self-host the relay</span> — copy{" "}
                  <span className="font-mono text-slate-300">api/freedns.py</span> to any always-on
                  box and run{" "}
                  <span className="font-mono text-slate-300">python3 api/freedns.py</span> (stdlib
                  only, listens on 0.0.0.0:8787, CORS open). Paste its URL below — signup, registry,
                  record creation and DynDNS all flow through it.
                </li>
                <li>
                  <span className="font-semibold text-slate-300">Skip the relay</span> — browse the
                  public registry below (needs nothing), use the 🪄 wildcard composer / manual BYOD
                  entry, and note DuckDNS &amp; ChangeIP updates work via public CORS relays.
                </li>
              </ol>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={relayInput}
                  onChange={(e) => setRelayInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyRelay()}
                  placeholder="http://74.208.64.80:8787/api/freedns"
                  spellCheck={false}
                  className="input-base min-w-[16rem] flex-1 px-2 py-1 font-mono text-xs"
                  title="Base URL of your self-hosted api/freedns.py"
                />
                <button onClick={applyRelay} disabled={busy !== null} className="btn-secondary !px-2.5 !py-1 text-[10px]">
                  Apply relay
                </button>
                {customRelayBase() && (
                  <button
                    onClick={() => {
                      setCustomRelayBase("");
                      setRelayInput("");
                      setRelayUp(null);
                    }}
                    disabled={busy !== null}
                    className="text-[10px] text-slate-500 hover:text-danger"
                    title="Forget the saved custom relay"
                  >
                    remove saved
                  </button>
                )}
              </div>
            </div>
          )}

          {!creds && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setStage("signup");
                  void solveCaptcha();
                }}
                disabled={!canTrySignup || busy !== null}
                className="btn-secondary !px-3 !py-1.5 text-[11px]"
                title="No FreeDNS account yet — one captcha, everything else is automatic"
              >
                🆕 New account (temp inbox)
              </button>
              <button
                onClick={() => {
                  setStage("login");
                  void solveCaptcha();
                }}
                disabled={!canTrySignup || busy !== null}
                className="btn-secondary !px-3 !py-1.5 text-[11px]"
                title="I already have a freedns.afraid.org account"
              >
                🔑 Log in
              </button>
              <button
                onClick={() => {
                  const next = !pubOpen;
                  setPubOpen(next);
                  if (!next) setPickedPub(null);
                  else if (pubDomains.length === 0) void loadPub(1);
                }}
                disabled={busy !== null}
                className="btn-secondary !px-3 !py-1.5 text-[11px]"
                title="Browse the 21k+ shared domains with no relay and no login — parsed in your browser"
              >
                🌐 Public registry {pubOpen ? "▲" : "▼"}
              </button>
              {creds && null}
            </div>
          )}

          {!creds && pubOpen && (
            <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <input
                  value={pubQuery}
                  onChange={(e) => setPubQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void loadPub(1, pubQuery.trim(), pubLeast)}
                  placeholder="search 21k+ shared domains (Enter)"
                  spellCheck={false}
                  className="input-base min-w-[12rem] flex-1 px-2 py-1 font-mono text-xs"
                />
                <button onClick={() => void loadPub(1, pubQuery.trim(), pubLeast)} disabled={busy !== null} className="btn-secondary !px-2.5 !py-1 text-[10px]">
                  Search
                </button>
                <button
                  onClick={() => {
                    setPubLeast(false);
                    void loadPub(1, pubQuery.trim(), false);
                  }}
                  disabled={busy !== null || !pubLeast}
                  className={`chip text-[10px] ${!pubLeast ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
                  title="Default FreeDNS order — the biggest shared domains first"
                >
                  ★ most popular
                </button>
                <button
                  onClick={() => {
                    setPubLeast(true);
                    void loadPub(1, pubQuery.trim(), true);
                  }}
                  disabled={busy !== null || pubLeast}
                  className={`chip text-[10px] ${pubLeast ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
                  title="Tail of FreeDNS's popularity sort — domains with only a handful of hosts"
                >
                  ↓ least popular
                </button>
                <span className="ml-auto font-mono text-[10px] text-slate-500">
                  page {pubPage} · {pubTotal.toLocaleString()} domains
                </span>
              </div>
              {pubVia === "public" && (
                <p className="mb-1 text-[10px] text-slate-500">
                  <span
                    className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] text-slate-400"
                    title="Fetched through a public CORS relay and parsed in your browser — no api/freedns.py involved"
                  >
                    via public relay
                  </span>{" "}
                  no login needed — pick a domain, then compose the host manually below.
                </p>
              )}
              {pubLeast && (
                <p className="mb-1 text-[10px] leading-relaxed text-slate-500">
                  Counting from the least-used end: page 1 is the registry's very last page (domains with 3–4 hosts).
                </p>
              )}
              <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {pubDomains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setPickedPub(d)}
                    title={`Use ${d.domain} — ${d.status}, ${d.hosts.toLocaleString()} hosts`}
                    className={`rounded border px-2 py-1 text-left font-mono text-[11px] transition ${
                      pickedPub?.id === d.id
                        ? "border-accent/60 bg-accent/10 text-accent-soft"
                        : "border-ink-600 bg-ink-900 text-slate-400 hover:border-accent/40 hover:text-accent-soft"
                    }`}
                  >
                    {d.domain}
                    <span className="ml-1 text-[9px] text-slate-600">{d.hosts.toLocaleString()} hosts</span>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                <button
                  onClick={() => void loadPub(Math.max(1, pubPage - 1), pubQuery.trim(), pubLeast)}
                  disabled={pubPage <= 1 || busy !== null}
                  className="hover:text-accent"
                >
                  ← prev
                </button>
                <button
                  onClick={() => void loadPub(pubPage + 1, pubQuery.trim(), pubLeast)}
                  disabled={pubPage >= Math.ceil(pubTotal / 100) || busy !== null}
                  className="hover:text-accent"
                >
                  next →
                </button>
              </div>
              {pickedPub && (
                <div className="mt-2 rounded border border-accent/30 bg-ink-900 p-2">
                  <p className="text-[11px] font-semibold text-slate-300">
                    Compose a host on <span className="font-mono text-accent-soft">{pickedPub.domain}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <input
                      value={manualSub}
                      onChange={(e) => setManualSub(e.target.value.replace(/[^a-z0-9-]/gi, "").slice(0, 30))}
                      placeholder="yourname"
                      spellCheck={false}
                      className="input-base w-32 px-2 py-1 font-mono text-xs"
                    />
                    <span className="font-mono text-[11px] text-accent">
                      {manualSub.trim() || "yourname"}.{pickedPub.domain}
                    </span>
                    <button
                      onClick={() => copyText(`${manualSub.trim() || "yourname"}.${pickedPub.domain}`)}
                      className="text-[10px] text-slate-500 hover:text-accent"
                    >
                      copy
                    </button>
                    <button
                      onClick={() => onAdopt(`${manualSub.trim() || "yourname"}.${pickedPub.domain}`)}
                      className="text-[10px] text-accent hover:underline"
                      title="Put this host in the BYOD box"
                    >
                      use in BYOD box
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    Create that sub on freedns.afraid.org (Subdomains → add) pointed at your IP — with a relay
                    reachable, the signup flow above does it in one click instead.
                  </p>
                </div>
              )}
            </div>
          )}

          {captchaImg && !creds && (
            <div className="space-y-2 rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
              <div className="flex items-center gap-2">
                <img src={captchaImg} alt="FreeDNS captcha" className="h-12 rounded border border-ink-500 bg-white" />
                <button
                  onClick={() => void solveCaptcha(stage === "records" ? sid : undefined)}
                  className="text-[10px] text-slate-500 hover:text-accent"
                >
                  ↻ new image
                </button>
                <label className="ml-auto text-[11px] text-slate-400">
                  {stage === "login" ? "login captcha" : "captcha"}:
                  <input
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value)}
                    placeholder="type the letters"
                    spellCheck={false}
                    className="input-base ml-1.5 w-28 px-2 py-1 font-mono text-xs"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  spellCheck={false}
                  className="input-base px-2 py-1 font-mono text-xs"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  className="input-base px-2 py-1 font-mono text-xs"
                />
              </div>
              {stage === "signup" && tempEmail && (
                <p className="font-mono text-[10px] text-slate-500">
                  activation mail → {tempEmail} (handled automatically)
                </p>
              )}
              <button onClick={stage === "login" ? doLogin : doSignup} disabled={busy !== null} className="btn-primary w-full py-1.5 text-xs">
                {stage === "login" ? "Log in" : "Create account & activate"}
              </button>
            </div>
          )}

          {creds && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="chip border-accent/40 text-accent-soft">
                  ✓ {creds.user} on freedns.afraid.org
                </span>
                <button onClick={() => void loadRegistry(creds.sid, 1, regQuery.trim(), regLeast)} disabled={busy !== null} className="btn-secondary !px-2.5 !py-1 text-[10px]">
                  Browse domains
                </button>
                <button onClick={() => void loadRecords(creds.sid)} disabled={busy !== null} className="btn-secondary !px-2.5 !py-1 text-[10px]">
                  My records
                </button>
                <button
                  onClick={() => {
                    setCreds(null);
                    setStage("idle");
                    setDomains([]);
                    setRecords([]);
                  }}
                  className="ml-auto text-[10px] text-slate-500 hover:text-danger"
                >
                  log out
                </button>
              </div>

              {/* Record creation — the point of the whole flow */}
              <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
                <p className="mb-1.5 text-[11px] font-semibold text-slate-300">
                  New record — this becomes a BYOD host
                </p>
                <div className="grid gap-1.5 sm:grid-cols-[1fr_auto]">
                  <select
                    value={pickedDomain?.id ?? ""}
                    onChange={(e) => {
                      const d = domains.find((x) => String(x.id) === e.target.value) ?? null;
                      setPickedDomain(d);
                    }}
                    className="input-base px-2 py-1 font-mono text-xs"
                    title="Pick from the shared-domain registry"
                  >
                    <option value="">
                      {domains.length === 0 ? "Browse domains first →" : "— pick a domain —"}
                    </option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.domain} ({d.hosts.toLocaleString()} hosts)
                      </option>
                    ))}
                  </select>
                  <input
                    value={subName}
                    onChange={(e) => setSubName(e.target.value.replace(/[^a-z0-9-]/gi, "").slice(0, 30))}
                    placeholder="yourname"
                    spellCheck={false}
                    className="input-base px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[80px_1fr]">
                  <select
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value as "A" | "AAAA" | "CNAME")}
                    className="input-base px-1 py-1 font-mono text-xs"
                    title="A: name → IPv4 · AAAA: name → IPv6 · CNAME: name → another name"
                  >
                    <option value="A">A</option>
                    <option value="AAAA">AAAA</option>
                    <option value="CNAME">CNAME</option>
                  </select>
                  <input
                    value={dest}
                    onChange={(e) => setDest(e.target.value.slice(0, 253))}
                    placeholder={recordType === "CNAME" ? "target host (e.g. mybox.example.com)" : "your IP — pre-filled with this browser's public IP"}
                    spellCheck={false}
                    className="input-base px-2 py-1 font-mono text-xs"
                  />
                </div>
                {pickedDomain && subName.trim() && (
                  <p className="mt-1.5 font-mono text-[11px] text-accent">
                    {subName.trim()}.{pickedDomain.domain} {recordType} {cleanDest(dest) || "…"}
                    {cleanDest(dest) && (
                      <button onClick={() => copyText(`${subName.trim()}.${pickedDomain.domain}`)} className="ml-2 text-[10px] text-slate-500 hover:text-accent">
                        copy host
                      </button>
                    )}
                  </p>
                )}
                {captchaImg && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <img src={captchaImg} alt="captcha" className="h-10 rounded border border-ink-500 bg-white" />
                    <input
                      value={captchaCode}
                      onChange={(e) => setCaptchaCode(e.target.value)}
                      placeholder="captcha"
                      spellCheck={false}
                      className="input-base w-24 px-2 py-1 font-mono text-xs"
                    />
                    <button onClick={() => void solveCaptcha(creds.sid)} className="text-[10px] text-slate-500 hover:text-accent">
                      ↻
                    </button>
                  </div>
                )}
                <button
                  onClick={doCreate}
                  disabled={!pickedDomain || !subName.trim() || !cleanDest(dest) || busy !== null}
                  className="btn-primary mt-1.5 w-full py-1.5 text-xs"
                >
                  Create record → add to BYOD
                </button>
              </div>

              {/* Registry browser */}
              {stage === "registry" && domains.length > 0 && (
                <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <input
                      value={regQuery}
                      onChange={(e) => setRegQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void loadRegistry(creds.sid, 1, regQuery.trim(), regLeast)}
                      placeholder="search 21k+ shared domains (Enter)"
                      spellCheck={false}
                      className="input-base flex-1 px-2 py-1 font-mono text-xs"
                    />
                    <button onClick={() => void loadRegistry(creds.sid, 1, regQuery.trim(), regLeast)} disabled={busy !== null} className="btn-secondary !px-2.5 !py-1 text-[10px]">
                      Search
                    </button>
                  </div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => {
                        setRegLeast(false);
                        void loadRegistry(creds.sid, 1, regQuery.trim(), false);
                      }}
                      disabled={busy !== null || !regLeast}
                      className={`chip text-[10px] ${!regLeast ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
                      title="Default FreeDNS order — the biggest shared domains first (mooo.com, chickenkiller.com…)"
                    >
                      ★ most popular
                    </button>
                    <button
                      onClick={() => {
                        setRegLeast(true);
                        void loadRegistry(creds.sid, 1, regQuery.trim(), true);
                      }}
                      disabled={busy !== null || regLeast}
                      className={`chip text-[10px] ${regLeast ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
                      title="Start at the tail of FreeDNS's popularity sort: shared domains with only a handful of hosts"
                    >
                      ↓ least popular
                    </button>
                    <span className="ml-auto font-mono text-[10px] text-slate-500">
                      page {regPage} · {regTotal.toLocaleString()} domains total
                    </span>
                  </div>
                  {regLeast && (
                    <p className="mb-1 text-[10px] leading-relaxed text-slate-500">
                      Counting from the least-used end: page 1 is the registry's very last page (domains with 3–4
                      hosts). Tiny shared domains give subdomains nobody has burned yet.
                    </p>
                  )}
                  <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                    {domains.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => {
                          setPickedDomain(d);
                          setStage("records");
                        }}
                        title={`Use ${d.domain} — ${d.status}, ${d.hosts.toLocaleString()} hosts`}
                        className={`rounded border px-2 py-1 text-left font-mono text-[11px] transition ${
                          pickedDomain?.id === d.id
                            ? "border-accent/60 bg-accent/10 text-accent-soft"
                            : "border-ink-600 bg-ink-900 text-slate-400 hover:border-accent/40 hover:text-accent-soft"
                        }`}
                      >
                        {d.domain}
                        <span className="ml-1 text-[9px] text-slate-600">{d.hosts.toLocaleString()} hosts</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <button
                      onClick={() => void loadRegistry(creds.sid, Math.max(1, regPage - 1), regQuery.trim(), regLeast)}
                      disabled={regPage <= 1 || busy !== null}
                      className="hover:text-accent"
                    >
                      ← prev
                    </button>
                    <button
                      onClick={() => void loadRegistry(creds.sid, regPage + 1, regQuery.trim(), regLeast)}
                      disabled={regPage >= Math.ceil(regTotal / 100) || busy !== null}
                      className="hover:text-accent"
                    >
                      next →
                    </button>
                  </div>
                </div>
              )}

              {/* Existing records — repoint = dynamic DNS */}
              {records.length > 0 && (
                <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-300">
                    Your records <span className="font-normal text-slate-500">— set the destination above, then repoint</span>
                  </p>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {records.slice(0, 60).map((r) => (
                      <div key={r.id} className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900 px-2 py-1">
                        <span className="truncate font-mono text-[11px] text-slate-300" title={r.subdomain}>
                          {r.subdomain}
                        </span>
                        <span className="shrink-0 rounded bg-ink-800 px-1 text-[9px] uppercase text-slate-500">{r.type}</span>
                        <span className="ml-auto truncate font-mono text-[10px] text-slate-500" title={r.destination}>
                          → {r.destination}
                        </span>
                        <button
                          onClick={() => void doRepoint(r)}
                          disabled={busy !== null || !cleanDest(dest) || cleanDest(dest) === r.destination}
                          className="shrink-0 text-[10px] text-accent hover:underline disabled:text-slate-600"
                          title={`Point ${r.subdomain} at ${cleanDest(dest) || "(set destination first)"}`}
                        >
                          repoint
                        </button>
                        <button onClick={() => onAdopt(r.subdomain)} className="shrink-0 text-[10px] text-accent hover:underline" title="Use this host in the BYOD box">
                          use
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
