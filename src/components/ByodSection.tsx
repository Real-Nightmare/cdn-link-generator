// Dedicated BYOD (Bring Your Own Domain/IP) section for Link Studio.
//
// The idea: the user has an IP — a box, VPS, school LAN mirror, anything that
// serves a webpage — and services like FreeDNS/sslip.io/DuckDNS turn that IP
// into a resolvable host. Paste the resulting host (or the raw IP) into the
// box and every asset × commit gains one extra link served from it.
//
// The directory below is reference material: grouped services, one-line setup
// commands, and a badge on the ONLY two providers that need a token (ngrok,
// zrok). Everything else works with zero signup, as requested.

import { memo, useState } from "react";
import { BYOD_MAX_HOSTS } from "../lib/cdns";
import {
  BYOD_KINDS,
  BYOD_PROVIDERS,
  ByodKind,
  ByodProvider,
  TUNNEL_COMMANDS,
} from "../lib/byod-providers";

const KIND_ICONS: Record<ByodKind, string> = {
  tunnel: "🛤️",
  ipmap: "🪄",
  dyn: "🔁",
  dns: "🧭",
  host: "🗄️",
};

function copyText(text: string): void {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    // clipboard unavailable — the text is visible anyway
  }
}

/** Directory entry: one provider with how-to, copy command for tunnels. */
function ProviderRow({ p }: { p: ByodProvider }) {
  const cmd = TUNNEL_COMMANDS.find((c) => c.site === p.domain);
  return (
    <div className="rounded-md border border-ink-600 bg-ink-900/60 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs text-slate-300" title={p.name}>
          {p.name}
        </span>
        {p.token && (
          <span
            className="shrink-0 rounded bg-warn/15 px-1 py-0.5 text-[9px] uppercase text-warn"
            title="Needs a free account/token — one of only two providers here that do"
          >
            token
          </span>
        )}
        {cmd && (
          <button
            onClick={() => copyText(cmd.cmd)}
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
            title={`Copy: ${cmd.cmd}`}
          >
            copy cmd
          </button>
        )}
        <a
          href={p.site}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] text-slate-500 hover:text-accent"
          title="Open the provider"
        >
          ↗
        </a>
      </div>
      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={p.how}>
        {p.how}
      </p>
    </div>
  );
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  hosts: string[];
  /** npm mode can't serve BYOD links (no repo path) — show a note instead. */
  npmMode: boolean;
  disabled?: boolean;
}

/**
 * BYOD section — always visible (not a CDN checkbox): the host box plus the
 * full provider directory. Memoized so keystrokes elsewhere on the page
 * don't re-render the directory.
 */
export const ByodSection = memo(function ByodSection({ value, onChange, hosts, npmMode, disabled }: Props) {
  const [openKind, setOpenKind] = useState<ByodKind | null>("tunnel");
  const ignored =
    value.trim().length > 0 &&
    value
      .trim()
      .split(/[\n,;\s]+/)
      .filter((t) => t.trim() && !t.trim().startsWith("#")).length > hosts.length;

  return (
    <div className="rounded-lg border border-accent/25 bg-ink-900/50 p-4 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">
          🖥️ BYOD IPs &amp; hosts
          <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">
            bring your own domain/IP
          </span>
        </p>
        <span
          className={`chip font-mono text-[10px] ${
            hosts.length > 0 ? "border-accent/50 text-accent-soft" : "text-slate-500"
          }`}
        >
          {hosts.length}/{BYOD_MAX_HOSTS} hosts · +{hosts.length.toLocaleString()} link
          {hosts.length === 1 ? "" : "s"} per asset×commit
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Your IP serves the page; a free DNS/tunnel service gives it a name. Paste the IP or host here
        and links come out on it — <span className="font-mono text-slate-400">https://host/owner/repo/sha/file.svg</span>.
        Bare ports serve <span className="font-mono">http://</span>. {BYOD_PROVIDERS.length} providers below,{" "}
        {BYOD_PROVIDERS.length - 2} need no token (only ngrok &amp; zrok do).
      </p>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 16_000))}
        rows={3}
        spellCheck={false}
        disabled={disabled}
        placeholder={
          "203.0.113.7\nmybox.example.com:8080\n[2001:db8::1]\nmyname.duckdns.org   # from any provider below\n192.0.2.7.sslip.io   # IP → name magic\n\n# comments allowed — everything after # is ignored"
        }
        className="input-base resize-y font-mono text-xs"
      />
      {hosts.length > 0 && (
        <p className="mt-1.5 text-[11px] text-accent">
          ✓ {hosts.length} valid host{hosts.length === 1 ? "" : "s"} — each one is its own serving slot
          (npm mode can't use them; repo mode only).
        </p>
      )}
      {value.trim().length > 0 && hosts.length === 0 && (
        <p className="mt-1 text-[11px] text-warn">No valid hosts found in that list yet.</p>
      )}
      {ignored && <p className="mt-1 text-[11px] text-warn">Some lines were ignored (invalid or duplicate hosts).</p>}
      {npmMode && (
        <p className="mt-1.5 text-[11px] text-warn">
          npm mode serves package CDNs only — switch to GitHub repos mode to link through your hosts.
        </p>
      )}

      {/* Provider directory — grouped, collapsible */}
      <div className="mt-3 border-t border-ink-700 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Provider directory — grab a host from any of these
        </p>
        <div className="mt-2 space-y-1.5">
          {BYOD_KINDS.map(({ kind, label, blurb }) => {
            const providers = BYOD_PROVIDERS.filter((p) => p.kind === kind);
            const open = openKind === kind;
            return (
              <div key={kind}>
                <button
                  onClick={() => setOpenKind(open ? null : kind)}
                  className="flex w-full items-center gap-2 rounded-md border border-ink-600 bg-ink-900/40 px-2.5 py-1.5 text-left transition hover:border-accent/40"
                >
                  <span className="text-sm">{KIND_ICONS[kind]}</span>
                  <span className="text-xs font-medium text-slate-200">{label}</span>
                  <span className="font-mono text-[10px] text-slate-500">{providers.length}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="mt-1.5 space-y-1.5 pl-3">
                    <p className="text-[10px] leading-relaxed text-slate-500">{blurb}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {providers.map((p) => (
                        <ProviderRow key={p.domain} p={p} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
