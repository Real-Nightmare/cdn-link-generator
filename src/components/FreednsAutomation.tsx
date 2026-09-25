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
import { freedns, FreednsDomain, FreednsRecord } from "../lib/freedns";

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

  useEffect(() => {
    if (!open || relayUp !== null) return;
    let on = true;
    freedns
      .ping()
      .then((ok) => on && setRelayUp(ok))
      .catch(() => on && setRelayUp(false));
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
                The relay (api/freedns.py) isn't reachable on this host — deploy it alongside the site
                to automate; manual BYOD entry still works.
              </span>
            )}
          </p>

          {error && <p className="text-[11px] text-danger">✗ {error}</p>}
          {busy && <p className="text-[11px] text-accent">{busy}</p>}

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
              {creds && null}
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
