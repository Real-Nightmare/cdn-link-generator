import { Link } from "react-router-dom";
import { CDN_PROVIDERS } from "../lib/cdns";
import { SectionHeading } from "../components/ui";

const FEATURES = [
  {
    icon: "⚡",
    title: "Rapid & Automatic",
    body: "One request scans the entire repo tree, then links stream in live. No installs, no wizards — type a repo and go.",
  },
  {
    icon: "🌐",
    title: `${CDN_PROVIDERS.length} CDN Providers`,
    body: "jsDelivr and every mirror, githubraw, Githack, Statically, esm.sh, gh-proxy, GitHub Pages, UNPKG and more — every SVG, every commit, every provider.",
  },
  {
    icon: "📦",
    title: "GitHub repos & npm packages",
    body: "Scan a repository's history, or load an npm package and turn the SVGs inside every published version into unpkg + jsDelivr links.",
  },
  {
    icon: "🎛️",
    title: "Presets & smart grouping",
    body: "One-tap presets — Recommended, UBG bulk, jsDelivr only — over providers grouped by type, with optional extras like Pages clearly marked.",
  },
  {
    icon: "🖥️",
    title: "BYOD IPs & hosts",
    body: "Bring your own IP — tunnels (Cloudflare, localhost.run, Serveo, bore), IP→name magic (sslip.io, nip.io), FreeDNS, DuckDNS and more turn any IP into working links. 24 providers, only ngrok & zrok need a token.",
  },
  {
    icon: "✅",
    title: "Live Validation",
    body: "Every generated link is checked from your browser in parallel, so you only ship URLs that actually respond.",
  },
  {
    icon: "🔒",
    title: "Zero Trust Needed",
    body: "Everything runs client-side. Your token and results never touch a server — they live in your browser only.",
  },
  {
    icon: "📁",
    title: "Copy, download, or ZIP",
    body: "Plain lists for quick pasting, CSV for spreadsheets, JSON for tooling — or a ZIP with one file per provider.",
  },
  {
    icon: "🕘",
    title: "It Remembers You",
    body: "Last repos, commits per SVG, chosen CDNs and validation prefs persist in your browser. Set it once, reuse forever.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Point it at a repo",
    body: "Enter any GitHub repository as owner/repo — or a full github.com URL. Public repos work instantly, no token required.",
  },
  {
    n: "02",
    title: "Pick your output",
    body: "Choose how many commits deep to go, apply a preset or hand-pick from the providers — validation runs in parallel as links generate.",
  },
  {
    n: "03",
    title: "Copy your links",
    body: "Valid links are marked green in real time. Copy the whole batch or download as .txt / .csv — done in seconds.",
  },
];

const FAQS = [
  {
    q: "Do I need a GitHub account or token?",
    a: "No. Public repositories work with zero setup. Adding a token (stored only in your browser) lifts GitHub's API rate limit from 60 to 5,000 requests/hour — useful for big repos or many runs.",
  },
  {
    q: "Where do my token and settings live?",
    a: "In your browser's localStorage, on your machine. There is no backend in this app — only the GitHub API calls you trigger are ever made.",
  },
  {
    q: "Which providers are optional?",
    a: "GitHub Pages only works for repos that actually publish a Pages site, and the npm CDNs (UNPKG, jsDelivr npm) need a package name — so both are opt-in and clearly marked. Everything else works out of the box. Want links on your OWN host? The BYOD section has 24 providers (tunnels, dynamic DNS, IP→name magic) — all but ngrok and zrok need zero signup.",
  },
  {
    q: "Why are links pinned to commit SHAs?",
    a: "Commit-pinned URLs are immutable: the file can never change under you, and CDNs can cache it forever. This tool walks the repo's real history, so every SVG gets a link per commit.",
  },
  {
    q: "A CDN shows as broken — is the tool wrong?",
    a: "Validation runs from your browser, so a provider unreachable from your network (or one without CORS headers) may be marked broken even though the URL is fine. Check a link manually before dismissing it.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="card group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-200">
        {q}
        <span className="shrink-0 text-accent transition-transform group-open:rotate-45">＋</span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">{a}</p>
    </details>
  );
}

export default function Landing() {
  return (
    <div>
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(52,211,153,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(52,211,153,0.04)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="animate-fade-up">
              <span className="chip mx-auto border-accent/30 text-accent-soft">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                SVG → CDN links · in your browser
              </span>
            </div>
            <h1 className="mt-6 animate-fade-up text-4xl font-extrabold leading-tight tracking-tight text-slate-50 sm:text-5xl lg:text-6xl">
              Turn any repo's SVGs into
              <span className="block bg-gradient-to-r from-accent-soft via-accent to-emerald-400 bg-clip-text text-transparent">
                ready-to-ship CDN links
              </span>
            </h1>
            <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
              Scan a GitHub repository (or an npm package), walk its history, and generate validated links
              across {CDN_PROVIDERS.length} CDNs — jsDelivr, Githack, Statically, esm.sh, UNPKG and more.
              All client-side, all automatic, done in seconds.
            </p>
            <div className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/generate" className="btn-primary w-full px-8 py-3 text-base sm:w-auto">
                Generate links now
              </Link>
              <a href="#how" className="btn-secondary w-full px-6 py-3 text-base sm:w-auto">
                See how it works
              </a>
            </div>
            <p className="mt-4 font-mono text-xs text-slate-500">
              e.g. <span className="text-accent-soft">twbs/icons</span> → 4,000+ validated links in one run
            </p>
          </div>

          {/* Terminal mock */}
          <div className="card animate-fade-up mx-auto mt-16 max-w-3xl overflow-hidden !bg-ink-900/90">
            <div className="flex items-center gap-1.5 border-b border-ink-700 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-danger/70" />
              <span className="h-3 w-3 rounded-full bg-warn/70" />
              <span className="h-3 w-3 rounded-full bg-accent/70" />
              <span className="ml-3 font-mono text-xs text-slate-500">cdn-link-studio</span>
            </div>
            <div className="space-y-1.5 p-5 font-mono text-sm">
              <p className="text-slate-400">
                <span className="text-accent">➜</span> repo: <span className="text-slate-100">twbs/icons</span>
                <span className="ml-2 animate-pulse-soft text-accent">▌</span>
              </p>
              <p className="text-accent">✓ Scanned tree — 2,085 SVG files found</p>
              <p className="text-accent">✓ Fetched 10 commits from history</p>
              <p className="text-slate-300">→ Generating 20,850 links across 21 CDNs…</p>
              <p className="text-accent">✓ Validated: 18,234 ok · 2,616 unreachable</p>
              <p className="text-slate-500"># copied to clipboard · cdn_links_twbs-icons.txt</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeading
          kicker="Why this tool"
          title="Built for speed, tuned for trust"
          sub="The whole pipeline — tree scan, commit walk, link build, validation — runs in your browser with real-time progress."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="card group p-6 transition hover:-translate-y-0.5 hover:border-accent/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-lg shadow-glow">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="border-y border-ink-700/60 bg-ink-900/40 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading kicker="The pipeline" title="Three steps. Seconds each." />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative">
                {i < STEPS.length - 1 && (
                  <div
                    aria-hidden
                    className="absolute left-full top-8 hidden h-px w-6 bg-gradient-to-r from-accent/40 to-transparent md:block"
                  />
                )}
                <div className="card h-full p-6">
                  <span className="font-mono text-3xl font-extrabold text-accent/25">{s.n}</span>
                  <h3 className="mt-3 font-semibold text-slate-100">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CDN grid ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeading
          kicker="Coverage"
          title={`${CDN_PROVIDERS.length} providers, one click`}
          sub="Every link is pinned to an immutable commit, served from whichever edge network you choose."
        />
        <div className="mt-12 flex flex-wrap justify-center gap-2.5">
          {CDN_PROVIDERS.map((c) => (
            <span key={c.id} className="chip font-mono hover:border-accent/50 hover:text-accent-soft">
              <span className="text-accent">{c.id}</span> {c.domain}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <SectionHeading kicker="FAQ" title="Questions, answered" />
        <div className="mt-10 space-y-3">
          {FAQS.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="card relative mx-auto max-w-4xl overflow-hidden bg-gradient-to-br from-ink-800 to-ink-900 p-10 text-center sm:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_120%,rgba(52,211,153,0.14),transparent)]"
          />
          <h2 className="relative text-2xl font-bold text-slate-50 sm:text-3xl">
            Your next batch of CDN links is one paste away
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-sm text-slate-400 sm:text-base">
            No install, no sign-up, no CLI. Just open the studio, drop in a repo, and start copying.
          </p>
          <Link to="/generate" className="btn-primary relative mt-8 px-8 py-3 text-base">
            Open the Studio →
          </Link>
        </div>
      </section>
    </div>
  );
}
