export default function Footer() {
  return (
    <footer className="border-t border-ink-700/70 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-slate-500 sm:flex-row sm:px-6">
        <p>
          <span className="font-mono font-semibold text-slate-300">CDN Link Studio</span> — SVG → multi-CDN
          links, entirely in your browser.
        </p>
        <p className="font-mono text-xs">
          No servers · No accounts · Powered by the GitHub REST API
        </p>
      </div>
    </footer>
  );
}
