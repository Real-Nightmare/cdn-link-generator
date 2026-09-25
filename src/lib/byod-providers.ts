// BYOD provider directory — curated services that turn an IP/host you control
// into a working public link, plus DNS/hosting services that make ANY IP
// reachable at a name. Paste the host (or grab one from a one-line command)
// into the BYOD box on the Studio page and every asset × commit gains a link
// on that host.
//
// Groupings mirror the dedicated BYOD section in the Studio UI:
//   • "Tunnel"       — expose localhost from ANY machine/IP, no port-forwarding
//   • "IP → name"    — wildcard DNS that maps any IP to a resolvable name
//   • "Dynamic DNS"  — free hostnames you point at your own IP
//   • "Free DNS"     — full DNS hosting for a domain you own
//   • "Free hosting" — static hosts that serve whatever you upload
//
// 24 providers. `token: true` marks the ONLY two that need an account/token
// (ngrok, zrok) — everything else works with zero signup as requested.

import { CDNProvider } from "./cdns";

export interface ByodProvider extends Omit<CDNProvider, "id" | "category" | "format" | "svgOnly"> {
  kind: ByodKind;
  /** True for the two providers that need a (free) token/account. */
  token?: boolean;
  /** How the user gets a host: "" = paste any IP, or a one-line command. */
  how: string;
  site: string;
}

export type ByodKind = "tunnel" | "ipmap" | "dyn" | "dns" | "host";

export const BYOD_KINDS: { kind: ByodKind; label: string; blurb: string }[] = [
  {
    kind: "tunnel",
    label: "Tunnels — expose localhost",
    blurb: "Run one command on the machine holding your files and it gets a public host — no port forwarding, works behind CGNAT/school Wi-Fi.",
  },
  {
    kind: "ipmap",
    label: "IP → name — any IP instantly",
    blurb: "Wildcard DNS magic: your raw IP becomes a resolvable hostname with zero signup. Paste an IP, get a name.",
  },
  {
    kind: "dyn",
    label: "Dynamic DNS — name your IP",
    blurb: "Free hostnames/subdomains you point at your own (even changing) IP.",
  },
  {
    kind: "dns",
    label: "Free DNS for your domain",
    blurb: "Free DNS hosting — point any domain or subdomain at your server.",
  },
  {
    kind: "host",
    label: "Free static hosting",
    blurb: "Drop files on a host that serves them at its own domain — no IP needed.",
  },
];

/** One-line commands shown in the UI (never executed by the app). */
export const TUNNEL_COMMANDS: { site: string; label: string; cmd: string }[] = [
  { site: "trycloudflare.com", label: "Cloudflare Tunnel (no install)", cmd: "cloudflared tunnel --url http://localhost:8000" },
  { site: "localhost.run", label: "localhost.run (plain SSH)", cmd: "ssh -R 80:localhost:8000 nokey@localhost.run" },
  { site: "serveo.net", label: "Serveo (plain SSH)", cmd: "ssh -R 80:localhost:8000 serveo.net" },
  { site: "bore.pub", label: "bore (single binary)", cmd: "bore local 8000 --to bore.pub" },
  { site: "pinggy.io", label: "Pinggy (plain SSH)", cmd: "ssh -p 443 -R0:localhost:8000 qr@free.pinggy.io" },
  { site: "tmole.io", label: "tunnelmole", cmd: "tmole 8000" },
  { site: "localtunnel", label: "localtunnel (npm)", cmd: "npx localtunnel --port 8000" },
  { site: "telebit", label: "Telebit", cmd: "telebit http 8000" },
  { site: "zrok.io", label: "zrok (token required)", cmd: "zrok share public http://localhost:8000" },
  { site: "ngrok.com", label: "ngrok (token required)", cmd: "ngrok http 8000" },
];

export const BYOD_PROVIDERS: ByodProvider[] = [
  // ---- Tunnels (localhost → public host; works from any machine/IP) ----
  {
    kind: "tunnel",
    name: "Cloudflare Quick Tunnel",
    domain: "trycloudflare.com",
    how: 'cloudflared tunnel --url http://localhost:8000  →  prints a random *.trycloudflare.com host',
    site: "https://trycloudflare.com",
    note: "Zero signup, zero install if you have cloudflared; host rotates each run",
  },
  {
    kind: "tunnel",
    name: "localhost.run",
    domain: "localhost.run",
    how: "ssh -R 80:localhost:8000 nokey@localhost.run  →  https://<rand>.lhr.life",
    site: "https://localhost.run",
    note: "Plain SSH from any terminal, no account",
  },
  {
    kind: "tunnel",
    name: "Serveo",
    domain: "serveo.net",
    how: "ssh -R 80:localhost:8000 serveo.net  →  https://<sub>.serveo.net",
    site: "https://serveo.net",
    note: "Pure SSH, nothing to install",
  },
  {
    kind: "tunnel",
    name: "bore",
    domain: "bore.pub",
    how: "bore local 8000 --to bore.pub  →  bore.pub:<port>",
    site: "https://github.com/ekzhang/bore",
    note: "Tiny single binary; bare-port host serves http://",
  },
  {
    kind: "tunnel",
    name: "Pinggy",
    domain: "free.pinggy.io",
    how: "ssh -p 443 -R0:localhost:8000 qr@free.pinggy.io  →  https://<rand>.free.pinggy.io",
    site: "https://pinggy.io",
    note: "SSH-only free tier, worldwide regions, no signup (token only for Pro)",
  },
  {
    kind: "tunnel",
    name: "tunnelmole",
    domain: "tmole.io",
    how: "tmole 8000  →  https://<rand>.tmole.io",
    site: "https://tunnelmole.com",
    note: "Open source, npm single command",
  },
  {
    kind: "tunnel",
    name: "localtunnel",
    domain: "loca.lt",
    how: "npx localtunnel --port 8000  →  https://<rand>.loca.lt",
    site: "https://theboroer.github.io/localtunnel-www/",
    note: "Runs via npx, no account",
  },
  {
    kind: "tunnel",
    name: "Telebit",
    domain: "telebit.cloud",
    how: "telebit http 8000  →  https://<rand>.telebit.cloud",
    site: "https://telebit.cloud",
    note: "One command install, no account",
  },
  {
    kind: "tunnel",
    name: "zrok",
    domain: "share.zrok.io",
    token: true,
    how: "zrok share public http://localhost:8000  →  https://<rand>.share.zrok.io",
    site: "https://zrok.io",
    note: "Free account token — one of the only two that need one",
  },
  {
    kind: "tunnel",
    name: "ngrok",
    domain: "ngrok-free.app",
    token: true,
    how: "ngrok http 8000  →  https://<rand>.ngrok-free.app",
    site: "https://ngrok.com",
    note: "Free authtoken — the other one that needs one",
  },

  // ---- IP → name (wildcard DNS over any raw IP; zero signup) ----
  {
    kind: "ipmap",
    name: "sslip.io",
    domain: "sslip.io",
    how: "Your IP IS the name: 192.0.2.7 → 192.0.2.7.sslip.io (also 192-0-2-7.sslip.io, ports too)",
    site: "https://sslip.io",
    note: "🧰 Compose it in-app (zero network) — the IP → name composer in this section",
  },
  {
    kind: "ipmap",
    name: "nip.io",
    domain: "nip.io",
    how: "192.0.2.7 → 192.0.2.7.nip.io (also dash form 192-0-2-7.nip.io)",
    site: "https://nip.io",
    note: "Same wildcard magic, long-running classic — 🧰 compose it in-app too",
  },

  // ---- Dynamic DNS (free hostnames for your own IP) ----
  {
    kind: "dyn",
    name: "DuckDNS",
    domain: "duckdns.org",
    how: "yourname.duckdns.org — free account, simple update script/token for changing IPs",
    site: "https://www.duckdns.org",
    note: "🔁 Point it at your IP from the in-app Dynamic DNS updater (relay op) — token, free account",
  },
  {
    kind: "dyn",
    name: "dynv6",
    domain: "dynv6.net",
    how: "yourname.dynv6.net — free account; HTTP/DHCP script updates",
    site: "https://dynv6.com",
    note: "Free, also hands out full zones and IPv6 prefixes — 🔁 update in-app (token)",
  },
  {
    kind: "dyn",
    name: "Dynu",
    domain: "dynu.net",
    how: "yourname.dynu.net or your own domain on their DNS — free account",
    site: "https://www.dynu.com",
    note: "Free dynamic DNS + full DNS hosting, no forced renewals — 🔁 update in-app (user+pass)",
  },
  {
    kind: "dyn",
    name: "No-IP",
    domain: "ddns.net",
    how: "yourname.ddns.net — free account; confirm monthly",
    site: "https://www.noip.com",
    note: "Long-running free dynamic DNS hostnames — 🔁 update in-app (user+pass)",
  },
  {
    kind: "dyn",
    name: "ChangeIP",
    domain: "changeip.com",
    how: "yourname.changeip.net / .com — free account",
    site: "https://www.changeip.com",
    note: "Free dynamic DNS + wildcard records on free tiers — 🔁 update in-app (user+pass)",
  },
  {
    kind: "dyn",
    name: "ClouDNS",
    domain: "cloudns.net",
    how: "Free subdomain (yourname.cloudns.nz etc.) with dynamic updates — free account",
    site: "https://www.cloudns.net",
    note: "Free tier includes DDNS and a free subdomain — update via their API key UI (no CORS-free GET)",
  },

  // ---- Free DNS hosting (domains you own, or free DNS zones) ----
  {
    kind: "dns",
    name: "FreeDNS (afraid.org)",
    domain: "mooo.com",
    how: "Point any record at your IP; thousands of shared public subdomains (mooo.com, chickenkiller.com…)",
    site: "https://freedns.afraid.org",
    note: "⚡ Automatable in-app (domain92 style) — the ⚡ automator in this section does it end to end",
  },
  {
    kind: "dns",
    name: "Hurricane Electric dns",
    domain: "he.net",
    how: "Free full DNS hosting for your domain — point A/AAAA records at your IP",
    site: "https://dns.he.net",
    note: "Free for unlimited zones, rock-solid anycast DNS",
  },
  {
    kind: "dns",
    name: "1984 Hosting",
    domain: "1984.hosting",
    how: "Free DNS + free domains (isn.se, bell.pw…) — point records at your IP",
    site: "https://www.1984.hosting",
    note: "Free-forever DNS hosting from the Icelandic host, free TLDs included",
  },
  {
    kind: "dns",
    name: "deSEC",
    domain: "dedyn.io",
    how: "yourname.dedyn.io or your own domain — free DNS + DDNS (token-managed)",
    site: "https://desec.io",
    note: "Open-source free DNS — 🔁 dedyn.io DDNS updates work in-app (token as password)",
  },

  // ---- Free static hosting (serve files at their domain; no IP needed) ----
  {
    kind: "host",
    name: "Netlify Drop",
    domain: "netlify.app",
    how: "Drag a folder onto app.netlify.com/drop → instant yourname.netlify.app",
    site: "https://app.netlify.com/drop",
    note: "Instant deploy, no account for the first drop",
  },
  {
    kind: "host",
    name: "Vercel",
    domain: "vercel.app",
    how: "Deploy any static folder/repo → yourname.vercel.app",
    site: "https://vercel.com",
    note: "Free static hosting with instant rollbacks",
  },
  {
    kind: "host",
    name: "Render Static Sites",
    domain: "onrender.com",
    how: "Static site deploy → yourname.onrender.com",
    site: "https://render.com",
    note: "Free tier static hosting, no card",
  },
  {
    kind: "host",
    name: "Surge.sh",
    domain: "surge.sh",
    how: "surge ./folder  →  yourname.surge.sh",
    site: "https://surge.sh",
    note: "Single-command publishing, custom subdomains free",
  },
];

/** The two providers that need an account/token (shown with a badge in UI). */
export const BYOD_TOKEN_PROVIDERS = BYOD_PROVIDERS.filter((p) => p.token);

export const BYOD_NO_TOKEN_COUNT = BYOD_PROVIDERS.length - BYOD_TOKEN_PROVIDERS.length;
