# CDN Link Studio

Turn any GitHub repository's SVG files into ready-to-ship, commit-pinned CDN links — entirely in your browser.

This is the web successor to the **cdn-link-generator** CLI (still available in the git history). Same proven pipeline — one Trees API call to scan the whole repo, real commit SHAs from history, links across 24 CDN providers, parallel validation — now with zero installation: open the site, paste a repo, copy links.

Also supports **npm package mode**: load a package like `bootstrap-icons`, and every SVG in every published version becomes unpkg + jsDelivr links.

## What it does

1. **Scan** — recursively finds every `.svg` in a repo via a single Git Trees API request
2. **Walk history** — fetches real commit SHAs (all, or the latest N)
3. **Generate** — builds a link per SVG per commit per provider — **smartly**: each commit's tree is checked, so links are only made when the SVG actually exists at that commit (no 404s for files added later or deleted since). Commit trees are fetched with bounded parallelism (6 at a time, hard per-request timeouts), and a user-set **link memory budget** (default 5M, up to 50M) auto-samples commit history — always keeping the newest commit — when a run would otherwise exceed it. The dataset is stored as a **compact implicit LinkSet** (prefix templates + file groups) — URLs are materialized only when needed, so **45M links build in under a second and cost ~100 MB** instead of gigabytes, on low-end devices too
4. **Validate** — checks every URL with bounded parallelism (HEAD, GET fallback, hard timeouts) — up to 512 workers, progress-throttled so 100k+ runs stay smooth. Runs above 2M links skip validation automatically (downloads still include every link)
5. **Filter Checker** *(optional)* — probes the **serving URLs** (host + full path, e.g. `cdn.jsdelivr.net/gh/user/repo@sha/icon.svg`) against **14 filter engines**: live school-filter vendor lookups (FortiGuard, Blocksi Web + AI, Linewize, Senso Cloud, Sophos SXL4 — all path-aware) plus host-level engines (Lightspeed, Deledao, Barracuda) and five DNS resolvers (Cloudflare Security/Family, CleanBrowsing Security/Family, OpenDNS FamilyShield) via DoH. A link is flagged when any engine blocks it at its exact URL, so a clear base domain no longer hides a blocked serving path (and vice versa). A **fast planner** builds the probe list straight from the LinkSet — ≤200 sampled candidates per serving host (newest commit always included; Pages/bunny URLs grouped by their real host) with per-filter counts computed arithmetically — so even 45M-link runs check in seconds, never walk the dataset. Vendor endpoints without CORS headers are proxied through the bundled Python API (`api/filter.py`), with a public-relay fallback on static previews; **per-filter unblocked exports** let you download exactly the links a specific filter (e.g. Lightspeed) does NOT block — one button per filter
6. **Ship** — copy all/valid/safe links to clipboard, or download as `.txt` / `.csv` / `.json`, or a **ZIP with one file per CDN** (plus `safe-links.txt` when the Filter Checker ran). Exports of **100 MB or more are offloaded to Gofile.io** automatically — the file uploads in the background worker and you get a share link instead of a frozen tab

## Repo Seeder

The **Seeder** page writes to your repos straight from the browser (token needs `Contents: read & write`):

- **SVG Seeder** — paste any SVG, choose 1–**10,000** copies, and it lands in the repo as that many files (`.autogen/`-style batched commits of 500 files each). Identical content is uploaded **once** as a single blob and referenced by every tree entry, so 10,000 files cost the bandwidth of one. Flat or nested layout.
- **Create repository** — spin up a new repo on your account straight from the page; it lands in the target fields ready to seed.
- **SVG Cloner** — scan any repo for its `.svg` files, tick the ones you want, and clone them into the target repo in one batched commit. If the token can't push to the source repo (a different account), the cloner **forks it to your account first** and clones from the fork — Git's content-addressed blobs make the copy free.
- **Artificial commits** — forge 1–**50** real commits that alternate adding and removing a tiny marker file under `.autogen/` (customizable base name, and they can target a new or existing branch), creating genuine history and SHAs that every CDN link can point at. Auto-commit mode keeps forging on a timer (1–60s) until you stop it or the cap is hit. One-click purge removes everything the feature created.

### Supported providers (24)

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

## Privacy

There is no backend for your data. Everything — scanning, generation, validation, your token, your settings — runs and lives in your browser (`localStorage`), with the entire heavy pipeline (generation, validation, filter checks, exports) executed in a **background Web Worker** so multi-hundred-thousand-link runs never freeze the page. The only network calls made are to `api.github.com`, the CDN URLs you validate, the public filter-vendor endpoints the Filter Checker probes, and `api/filter.py` (a stdlib-only Python proxy deployed alongside the site for filter endpoints without CORS headers).

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
