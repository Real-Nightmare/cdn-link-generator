// BYOD automator toolbox — the ⚡ FreeDNS panel's siblings, one per provider
// kind in the directory. What "automate" means per kind (honest scoping):
//
//   • IP → name (sslip.io / nip.io): 100% client-side. Wildcard DNS needs no
//     account, no API, no network call — the name IS the IP. Compose it, adopt
//     it, done.
//   • Dynamic DNS (DuckDNS, dynv6, Dynu, No-IP, ChangeIP, deSEC): one relay
//     call (kind=dyndns) points/updates the hostname at your IP — none of
//     those endpoints send CORS headers, so the browser can't reach them
//     directly. You bring the (free) account credentials/token.
//   • Tunnels: a machine-side process prints the host, so the app can't create
//     it — a launcher copies the one-liner, you paste back the printed host
//     and it's adopted.
//   • deSEC / HE / 1984 / CloudDNS: full-DNS panel providers — guided links
//     (deSEC's dedyn.io DDNS does work through the relay op above).
//
// Everything feeds onAdopt → the BYOD box → links on your host.

import { memo, useCallback, useEffect, useState } from "react";
import { freedns, FREEDNS_API } from "../lib/freedns";
import { isByodHost } from "../lib/cdns";
import { TUNNEL_COMMANDS } from "../lib/byod-providers";

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

/** Pull the bare host/IP out of anything the user pasted. */
function cleanHost(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split("/")[0]
    .trim();
}

function isIPv4(s: string): boolean {
  const p = s.split(".");
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

// ── IP → name composer (sslip.io / nip.io) — fully client-side ───────────────

function WildcardComposer({ onAdopt }: { onAdopt: (host: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState("");
  const [suffix, setSuffix] = useState<"sslip.io" | "nip.io">("sslip.io");
  const [port, setPort] = useState("");

  const cleanIp = cleanHost(ip);
  const validIp = isIPv4(cleanIp) || /^\[[0-9a-f:]+\]$/i.test(cleanIp);
  const host = validIp ? `${cleanIp}${port ? `:${port}` : ""}.${suffix}` : "";
  const valid = !!host && isByodHost(host);

  return (
    <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-xs font-semibold text-slate-300">🪄 IP → name composer (sslip.io / nip.io)</span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] leading-relaxed text-slate-500">
            Wildcard DNS: your IP <em>is</em> the hostname — zero signup, nothing to create. Type the IP, adopt the
            name. Works instantly for any IPv4/IPv6.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-[1fr_auto_auto]">
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value.slice(0, 60))}
              placeholder="your IP — e.g. 203.0.113.7 or [2001:db8::1]"
              spellCheck={false}
              className="input-base px-2 py-1 font-mono text-xs"
            />
            <select
              value={suffix}
              onChange={(e) => setSuffix(e.target.value as "sslip.io" | "nip.io")}
              className="input-base px-1 py-1 font-mono text-xs"
            >
              <option value="sslip.io">.sslip.io</option>
              <option value="nip.io">.nip.io</option>
            </select>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="port?"
              spellCheck={false}
              className="input-base w-20 px-2 py-1 font-mono text-xs"
              title="Optional — e.g. 8080. Bare ports serve http:// in the BYOD box."
            />
          </div>
          {ip.trim() && !validIp && <p className="text-[10px] text-warn">Enter a valid IPv4 or [IPv6] first.</p>}
          {valid && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-accent-soft">{host}</span>
              <button onClick={() => copyText(host)} className="text-[10px] text-slate-500 hover:text-accent">
                copy
              </button>
              <button
                onClick={() => {
                  onAdopt(host);
                  setIp("");
                  setPort("");
                }}
                className="btn-primary !px-3 !py-1 text-[11px]"
              >
                Add to BYOD →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dynamic DNS updater (DuckDNS & co) — one relay call ──────────────────────

type DdnsProvider = "duckdns" | "dynv6" | "dynu" | "noip" | "changeip" | "desec";

const DDNS_PROVIDERS: { id: DdnsProvider; label: string; auth: "token" | "userpass"; hint: string }[] = [
  { id: "duckdns", label: "DuckDNS", auth: "token", hint: "token from www.duckdns.org — host is the label (yourname.duckdns.org → yourname)" },
  { id: "dynv6", label: "dynv6", auth: "token", hint: "HTTP token from dynv6.com → My Account" },
  { id: "dynu", label: "Dynu", auth: "userpass", hint: "your Dynu username + password" },
  { id: "noip", label: "No-IP", auth: "userpass", hint: "your No-IP login (group hostnames work too)" },
  { id: "changeip", label: "ChangeIP", auth: "userpass", hint: "your ChangeIP username + password" },
  { id: "desec", label: "deSEC", auth: "token", hint: "account token; host is the zone, e.g. yourname.dedyn.io" },
];

function DynDnsUpdater({ onAdopt }: { onAdopt: (host: string) => void }) {
  const [open, setOpen] = useState(false);
  const [relayUp, setRelayUp] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<DdnsProvider>("duckdns");
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!open || relayUp !== null) return;
    let on = true;
    freedns
      .ping()
      .then((r) => on && setRelayUp(r))
      .catch(() => on && setRelayUp(false));
    return () => {
      on = false;
    };
  }, [open, relayUp]);

  const meta = DDNS_PROVIDERS.find((p) => p.id === provider)!;
  const clean = cleanHost(host);
  const ready = !!clean && (meta.auth === "token" ? !!token.trim() : !!user.trim() && !!pass);

  async function doUpdate() {
    if (!ready || busy) return;
    setBusy(`Updating ${clean} → ${ip.trim() || "your public IP"}…`);
    setError(null);
    setOk(null);
    try {
      const r = await freedns.dyndns({
        provider,
        host: clean,
        ip: cleanHost(ip),
        token: token.trim(),
        user: user.trim(),
        pass,
      });
      setOk(`${r.host} → ${r.ip}  ✓ (${r.reply})`);
      onAdopt(r.host);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-xs font-semibold text-slate-300">🔁 Dynamic DNS updater (DuckDNS · dynv6 · Dynu · No-IP · ChangeIP · deSEC)</span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] leading-relaxed text-slate-500">
            Create the (free) hostname on the provider's site once, then point it at your IP from here — the same
            update their script does, sent through this app's relay because those APIs send no CORS headers. Your IP
            changes (dyn-DNS style)? Update again, or leave IP empty to use this browser's public IP.
          </p>
          <div className="flex flex-wrap gap-1">
            {DDNS_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`chip text-[10px] ${provider === p.id ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">{meta.hint}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value.slice(0, 120))}
              placeholder={provider === "duckdns" ? "yourname (label) or full host" : "yourname.duckdns.org-style host"}
              spellCheck={false}
              className="input-base px-2 py-1 font-mono text-xs"
            />
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value.slice(0, 60))}
              placeholder="target IP (empty = this browser's public IP)"
              spellCheck={false}
              className="input-base px-2 py-1 font-mono text-xs"
            />
            {meta.auth === "token" ? (
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value.slice(0, 80))}
                placeholder="API token"
                className="input-base px-2 py-1 font-mono text-xs sm:col-span-2"
              />
            ) : (
              <>
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value.slice(0, 80))}
                  placeholder="username"
                  spellCheck={false}
                  className="input-base px-2 py-1 font-mono text-xs"
                />
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value.slice(0, 80))}
                  placeholder="password"
                  className="input-base px-2 py-1 font-mono text-xs"
                />
              </>
            )}
          </div>
          {relayUp === false && (
            <p className="text-[10px] text-warn">
              The relay (api/freedns.py) isn't reachable on this host — deploy it alongside the site; manual entry
              below still works.
            </p>
          )}
          {error && <p className="text-[11px] text-danger">✗ {error}</p>}
          {ok && (
            <p className="text-[11px] text-accent-soft">
              ✓ {ok}
              <button onClick={() => copyText(clean)} className="ml-2 text-[10px] text-slate-500 hover:text-accent">
                copy host
              </button>
            </p>
          )}
          <button onClick={doUpdate} disabled={!ready || busy !== null || relayUp === false} className="btn-primary w-full py-1.5 text-xs">
            {busy ?? `Point ${clean || "host"} at my IP`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tunnel launcher — copy the one-liner, paste back the printed host ────────

function TunnelLauncher({ onAdopt }: { onAdopt: (host: string) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const valid = !!host && isByodHost(cleanHost(host));
  const cmd = TUNNEL_COMMANDS.find((c) => c.site === picked);

  return (
    <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-xs font-semibold text-slate-300">🛤️ Tunnel launcher — copy, run, paste the host back</span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] leading-relaxed text-slate-500">
            Tunnels print a random public host when the command runs on the machine serving your files — the app can't
            run it for you, so: copy the one-liner → run it → paste the printed host here → it lands in the BYOD box.
          </p>
          <div className="flex flex-wrap gap-1">
            {TUNNEL_COMMANDS.map((c) => (
              <button
                key={c.site}
                onClick={() => setPicked(c.site === picked ? null : c.site)}
                className={`chip text-[10px] ${picked === c.site ? "border-accent/50 text-accent-soft" : "text-slate-500 hover:border-accent/40"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {cmd && (
            <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-950 px-2 py-1.5">
              <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-slate-300">{cmd.cmd}</code>
              <button onClick={() => copyText(cmd.cmd)} className="shrink-0 text-[10px] text-accent hover:underline">
                copy
              </button>
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value.slice(0, 160))}
              placeholder="paste the printed host — e.g. https://odd-words-here.trycloudflare.com"
              spellCheck={false}
              className="input-base flex-1 px-2 py-1 font-mono text-xs"
            />
            <button
              onClick={() => {
                if (valid) {
                  onAdopt(cleanHost(host));
                  setHost("");
                }
              }}
              disabled={!valid}
              className="btn-primary shrink-0 !px-3 text-[11px]"
            >
              Add to BYOD →
            </button>
          </div>
          {host.trim() && !valid && (
            <p className="text-[10px] text-warn">That doesn't parse as a host (strip everything but the hostname, or include one port).</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Full-DNS panel — guided signup links + Wildcard/DuckDNS cross-links ──────

const GUIDED = [
  { name: "deSEC dedyn.io", site: "https://desec.io", note: "Free zone + DDNS token — its update endpoint works in the 🔁 Dynamic DNS updater above." },
  { name: "Hurricane Electric", site: "https://dns.he.net", note: "Free anycast DNS for a domain you own — add the zone, point A/AAAA at your IP." },
  { name: "1984 Hosting", site: "https://www.1984.hosting", note: "Free DNS, even free domains (is, pw…). Same pattern: add zone → A record → your IP." },
];

function GuidedPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-ink-600 bg-ink-900/60 p-2.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-xs font-semibold text-slate-300">🧭 Full DNS panels (deSEC · HE · 1984) — guided setup</span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] leading-relaxed text-slate-500">
            These are full-DNS control panels: no public registry to automate, but the flow is three steps and the
            record you make drops straight into the BYOD box:
          </p>
          <ol className="ml-4 list-decimal space-y-0.5 text-[10px] text-slate-500">
            <li>create the (free) account + zone on the panel,</li>
            <li>add an A/AAAA record pointing at your IP (or a CNAME at a host you already have),</li>
            <li>paste the hostname into the BYOD box above.</li>
          </ol>
          <div className="space-y-1">
            {GUIDED.map((g) => (
              <div key={g.site} className="flex items-start gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1">
                <span className="font-mono text-[11px] text-slate-300">{g.name}</span>
                <span className="flex-1 text-[10px] text-slate-500">{g.note}</span>
                <a href={g.site} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] text-accent hover:underline">
                  open ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assembled toolbox ────────────────────────────────────────────────────────

interface Props {
  onAdopt: (host: string) => void;
}

/** All the non-FreeDNS automators, stacked under the FreeDNS panel. */
export const ByodAutomators = memo(function ByodAutomators({ onAdopt }: Props) {
  const [open, setOpen] = useState(false);

  // Resolve the browser's public IP once for the DuckDNS panel's placeholder.
  const [webIp, setWebIp] = useState("");
  const fetchIp = useCallback(() => {
    freedns
      .webip()
      .then(setWebIp)
      .catch(() => {});
  }, []);
  useEffect(fetchIp, [fetchIp]);

  return (
    <div className="mt-2 rounded-lg border border-accent/15 bg-ink-900/40 p-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left" title="Automators for every other BYOD provider kind">
        <span className="text-sm">🧰</span>
        <span className="text-xs font-semibold text-slate-200">
          More BYOD automators — wildcard DNS, dynamic DNS, tunnels
        </span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] leading-relaxed text-slate-500">
            The ⚡ FreeDNS panel's siblings — one tool per provider kind. {webIp ? (
              <>
                This browser's public IP is <span className="font-mono text-slate-400">{webIp}</span> (pre-fill below).
              </>
            ) : (
              "Fill in your IP below; the FreeDNS relay supplies it automatically when reachable."
            )}
          </p>
          <WildcardComposer onAdopt={onAdopt} />
          <DynDnsUpdater onAdopt={onAdopt} />
          <TunnelLauncher onAdopt={onAdopt} />
          <GuidedPanel />
          <p className="text-[10px] text-slate-600">
            Relay calls go to <span className="font-mono">{FREEDNS_API}</span> (same one the FreeDNS panel uses);
            wildcard composition is pure client-side — no network at all.
          </p>
        </div>
      )}
    </div>
  );
});
