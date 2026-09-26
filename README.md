# CDN Link Studio

Turn any GitHub repository's SVG files into ready-to-ship, commit-pinned CDN links — entirely in your browser.

This is the web successor to the **cdn-link-generator** CLI (still available in the git history). Same proven pipeline — one Trees API call to scan the whole repo, real commit SHAs from history, links across 25 CDN providers **plus your own BYOD IPs/hosts**, parallel validation — now with zero installation: open the site, paste a repo, copy links.

Also supports **npm package mode**: load a package like `bootstrap-icons`, and every SVG in every published version becomes unpkg + jsDelivr links.

## What it does

1. **Scan** — recursively finds every `.svg` in a repo via a single Git Trees API request
2. **Walk history** — fetches real commit SHAs (all, or the latest N)
3. **Generate** — builds a link per SVG per commit per provider — **smartly**: each commit's tree is checked, so links are only made when the SVG actually exists at that commit (no 404s for files added later or deleted since). Commit trees are fetched with bounded parallelism (6 at a time, hard per-request timeouts), and a user-set **link memory budget** (default 5M, up to 50M) auto-samples commit history — always keeping the newest commit — when a run would otherwise exceed it. The dataset is stored as a **compact implicit LinkSet** (prefix templates + file groups) — URLs are materialized only when needed, so **45M links build in under a second and cost ~100 MB** instead of gigabytes, on low-end devices too
4. **Validate** — checks every URL with bounded parallelism (HEAD, GET fallback, hard timeouts) — up to 512 workers, progress-throttled so 100k+ runs stay smooth. Runs above 2M links skip validation automatically (downloads still include every link)
5. **Filter Checker** *(optional)* — probes the **serving URLs** (host + full path, e.g. `cdn.jsdelivr.net/gh/user/repo@sha/icon.svg`) against **14 filter engines**: live school-filter vendor lookups (FortiGuard, Blocksi Web + AI, Linewize, Senso Cloud, Sophos SXL4 — all path-aware) plus host-level engines (Lightspeed, Deledao, Barracuda) and five DNS resolvers (Cloudflare Security/Family, CleanBrowsing Security/Family, OpenDNS FamilyShield) via DoH. A link is flagged when any engine blocks it at its exact URL, so a clear base domain no longer hides a blocked serving path (and vice versa). A **fast planner** builds the probe list straight from the LinkSet — up to 200 distinct-path probes per serving host (adaptive to host count, shared fairly across every repo; newest commit's paths first, Pages/bunny URLs grouped by their real host) with per-filter counts computed arithmetically — "unblocked" totals only count links the filter actually answered, unverified links are reported separately, and a blocked host flags every URL behind it — so even 45M-link runs check in seconds, never walk the dataset. Vendor endpoints without CORS headers are proxied through the bundled Python API (`api/filter.py`), with a public-relay fallback on static previews; **per-filter exports** let you download, for EVERY filter, exactly the links it does NOT block (⬇) and separately the links it verified as blocked (⛔) — two downloads per filter, unverified links land in neither
6. **Ship** — copy all/valid/safe links to clipboard, or download as `.txt` / `.csv` / `.json`, or a **ZIP with one file per CDN** (plus `safe-links.txt` when the Filter Checker ran). Exports of **20 MB or more (or 2M+ links) are offloaded to Gofile.io** automatically — the file uploads in the background worker, the **share link is copied to your clipboard**, and you skip the slow giant-download entirely. Copying a link list too big for the clipboard also returns a Gofile link instead. Every export is **streamed**: batches are spooled straight into a disk-backed Blob as they're produced, so even a multi-gigabyte export peaks at a few MB of worker memory instead of crashing the tab — with live "Preparing export… / Uploading to Gofile.io… %" progress

## Repo Seeder

The **Seeder** page writes to your repos straight from the browser (token needs `Contents: read & write`):

- **SVG Seeder** — paste any SVG, choose 1–**10,000** copies, and it lands in the repo as that many files (`.autogen/`-style batched commits of 500 files each). Identical content is uploaded **once** as a single blob and referenced by every tree entry, so 10,000 files cost the bandwidth of one. Flat or nested layout.
- **Create repository** — spin up a new repo on your account straight from the page; it lands in the target fields ready to seed.
- **SVG Cloner** — scan any repo for its `.svg` files, tick the ones you want, and clone them into the target repo in one batched commit. If the token can't push to the source repo (a different account), the cloner **forks it to your account first** and clones from the fork — Git's content-addressed blobs make the copy free.
- **Artificial commits** — forge 1–**50** real commits that alternate adding and removing a tiny marker file under `.autogen/` (customizable base name, and they can target a new or existing branch), creating genuine history and SHAs that every CDN link can point at. Auto-commit mode keeps forging on a timer (1–60s) until you stop it or the cap is hit. One-click purge removes everything the feature created.

### Supported providers (24 + BYOD hosts)

Every URL format is live-tested against a real commit / package before shipping.

| # | Provider | Note |
|---|----------|------|
| 1–6 | jsDelivr (cdn / fastly / gcore / testingcf / quantil / originfastly) | Primary + regional mirrors |
| 7 | cdn.staticdelivr.com | Commit path style |
| 8–9 | jsd.onmicrosoft.cn, cdn.jsdmirror.com | CN mirrors |
| 10–11 | githubraw.com, cdn.githubraw.com | SVG-only |
| 12–13 | raw.githack.com, rawcdn.githack.com | Dev / CDN cache modes |
| 14 | cdn.statically.io | Multi-purpose open-source CDN |
| 15 | raw.githubusercontent.com | Official raw host |
| 17 | gh-proxy.com | Optional proxy wrapper |
| 18 | ghproxy.net | Optional proxy wrapper |
| 23–24 | gh.llkk.cc, ghfast.top | Optional proxy wrappers |
| 21 | `{owner}.github.io` | Optional — requires a Pages site |
| 22 | Bunny CDN (`{zone}.b-cdn.net`) | Optional — your own pull zone mirroring raw.githubusercontent.com; set the zone in Link Studio |
| 16 | esm.sh | ESM CDN |
| 19 | unpkg.com | Optional — npm package mode |
| 20 | jsDelivr npm | Optional — npm package mode |

### BYOD IPs — a dedicated section with 24 provider recipes + automated FreeDNS

The Studio has a **dedicated BYOD IPs & hosts section** (no longer a checkbox in the CDN list). Paste up to **256** of your own IPs or hosts — IPv4 (`203.0.113.7`), IPv6 in brackets (`[2001:db8::1]`), hostnames (`mirror.example.com`), optional ports (`10.0.0.14:8080`). Newlines, commas or spaces separate entries; `#` starts a comment; duplicates and junk are dropped automatically. Every valid host becomes its own extra serving slot, so **every asset × commit gains one more link per host** — at the same few-MB LinkSet cost (each slot is a ~100-byte prefix template, never a materialized URL).

#### ⚡ Automated FreeDNS (domain92 style)

The BYOD section embeds an **automator for freedns.afraid.org** — the same flow as [sebastian-92/domain92](https://github.com/sebastian-92/domain92) (which automates FreeDNS via [ading2210's freedns-client](https://github.com/ading2210/freedns-client) and a guerrillamail temp inbox), now built into the app:

1. **Captcha → account** — solve one FreeDNS captcha; the app creates the account with a temp inbox as the email
2. **Auto-activation** — the relay (`api/freedns.py`) polls the temp inbox, catches the FreeDNS activation mail and opens the activation link — no inbox visit, no pip install, no CLI
3. **Registry browser** — search/paginate the **21,000+ shared public domains** (`mooo.com`, `chickenkiller.com`, `strangled.net`, …)
4. **Least-popular domains** — a one-click sort reversal counts pages from the registry's *last* page instead of the first, so page 1 shows the shared domains with only **3–4 hosts in use** (live-verified: page 1 under popularity sort = `mooo.com` with 870k hosts; page 214 = domains nobody uses). Tiny shared domains mean subdomains nobody has burned yet — the relay fetches FreeDNS's tail pages (`sort=5`, reversed paging) and caches the page count per search.
5. **Record → BYOD** — create `yourname.<domain> A <your IP>` (IP pre-filled with the browser's public IP; AAAA/CNAME supported). The new host is **adopted straight into the BYOD box**, so links come out on it immediately
6. **Dynamic DNS** — existing records are listed and can be **repointed** at a new IP with one captcha

FreeDNS sends no CORS headers, so the browser talks to `api/freedns.py` — a **stdlib-only** Python relay (same shape as the Filter Checker's `api/filter.py`, ASGI + Lambda handlers, in-memory sessions). Captchas are the only manual step; FreeDNS requires them for signup, login anomalies, and every record change. The client tries **three relay tiers**, so a static-only deploy (where `/api/*` falls through to the SPA) degrades gracefully instead of breaking:

1. **Same-origin relay** — `api/freedns.py` deployed alongside the site, when the host runs Python.
2. **Custom relay URL** — when the panel reports the relay isn't reachable, paste the base URL of a self-hosted copy into the ⚡ panel's field (it persists in localStorage and is tried first). Self-hosting is one command with zero dependencies: copy `api/freedns.py` to any always-on box and run `python3 api/freedns.py` — it serves JSON with open CORS on `0.0.0.0:8787` (pass a port as the first argument).
3. **Public CORS relays** — for the sessionless parts, no relay needed at all: the **public registry browser** (🌐 button) fetches freedns.afraid.org's registry through CORS-open public proxies (allorigins → codetabs → r.jina.ai, with a markdown-mode parser as final fallback) and parses it in your browser — including the least-popular tail pages — and **DuckDNS & ChangeIP** updates (pure-GET APIs) go through the raw-byte proxies too. Ops that need the FreeDNS login session (signup, record create/update) still require tier 1 or 2; the 🪄 wildcard composer and manual BYOD entry never need one.

#### 🧰 More BYOD automators — every other provider kind

The FreeDNS panel's siblings live in a second toolbox below it (one tool per directory kind):

- **🪄 IP → name composer** (sslip.io / nip.io) — **100% client-side, zero network**: wildcard DNS needs no account and no API, the name *is* the IP. Type your IPv4/IPv6 (+ optional port), pick `.sslip.io` or `.nip.io`, adopt `203.0.113.7.sslip.io` straight into the BYOD box.
- **🔁 Dynamic DNS updater** (DuckDNS, dynv6, Dynu, No-IP, ChangeIP, deSEC) — create the free hostname on the provider's site once, then point it at your IP from here: the same update their script does, sent through the relay's stateless `kind=dyndns` op (verified live: DuckDNS `OK`, dynv6/dynu/noip dyndns2 `good <ip>`, ChangeIP query-creds, deSEC basic-auth). Your IP changed? Update again — leave the IP empty to use the browser's public IP. (ClouDNS stays manual: its API is a signed GET with no CORS-free path.)
- **🛤️ Tunnel launcher** (all 10 tunnels) — tunnels print a random host from a process on your machine, so the app can't create it: copy the one-liner → run it → paste the printed host back → adopted.
- **🧭 Full DNS panels** (deSEC, Hurricane Electric, 1984) — guided three-step flow (account → A record → paste host); deSEC's `dedyn.io` DDNS endpoint also works in the updater above.

The section ships a **provider directory** for getting that IP onto the internet, grouped in five kinds:

| Kind | Providers | Needs token? |
|---|---|---|
| Tunnels (expose localhost) | Cloudflare Quick Tunnel, localhost.run, Serveo, bore, Pinggy, tunnelmole, localtunnel, Telebit, zrok, ngrok | only zrok & ngrok |
| IP → name (wildcard DNS) | sslip.io, nip.io | none |
| Dynamic DNS | DuckDNS, dynv6, Dynu, No-IP, ChangeIP, ClouDNS | none |
| Free DNS for your domain | FreeDNS (afraid.org) — ⚡ **automated in-app**, Hurricane Electric, 1984 Hosting, deSEC | none |
| Free static hosting | Netlify Drop, Vercel, Render, Surge.sh | none |

Tunnel entries carry a one-line setup command you can copy with a click; every entry links to its site. **22 of 24 providers need no account at all** — only ngrok and zrok ask for a (free) token. Directory notes mark which providers have an in-app automator (⚡ full auto, 🧰 compose, 🔁 relay update).

- Link shape: `https://host/owner/repo/sha/path.svg` (mirror-style path, like Githack) — point the host at your repo origin, or any server that reflects the path. Bare ports serve `http://`, everything else `https://`.
- **Filter Checker aware**: each BYOD IP is its own serving host in the probe plan — host-level engines verdict that IP's links alone, path-aware engines probe the IP's distinct paths, and a blocked IP flags only its own links (never the CDNs').
- Everything downstream just works: scope counts, validation, table, copy, txt/CSV/JSON/ZIP exports (each IP even gets its own `.txt` in the ZIP), and Gofile offload.
- BYOD hosts apply in **repo mode**; npm mode keeps its package CDNs. The list persists in localStorage with your other settings.

## Privacy

There is no backend for your data. Everything — scanning, generation, validation, your token, your settings — runs and lives in your browser (`localStorage`), with the entire heavy pipeline (generation, validation, filter checks, exports) executed in a **background Web Worker** so multi-hundred-thousand-link runs never freeze the page. The only network calls made are to `api.github.com`, the CDN URLs you validate, the public filter-vendor endpoints the Filter Checker probes, and the stdlib-only Python relays deployed alongside the site for endpoints without CORS headers (`api/filter.py` for filters, `api/freedns.py` for the FreeDNS automator and the dynamic-DNS updater — wildcard-DNS composition is pure client-side).

- **No token needed** for public repos (60 API requests/hour)
- **Optional token** raises the limit to 5,000/hour — stored locally, verifiable in one click, never sent anywhere but GitHub

## Running it

```bash
bun install     # or npm install
bun run dev     # development server (respects $PORT, binds 0.0.0.0)
bun run build   # production build → dist/
```

### Tech

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · React Router (hash routing, static-host friendly) · Web Worker pipeline (generation/validation/exports off the UI thread) · Zero-dep in-browser ZIP export

Zero runtime dependencies beyond React and the router — no UI kit, no state library.

## License

MIT — see [LICENSE](LICENSE).
