import { Link, useLocation } from "react-router-dom";

export default function Header() {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/70 bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent shadow-glow">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6l-5 6 5 6" />
              <path d="M16 6l5 6-5 6" />
            </svg>
          </span>
          <span className="font-mono text-base font-bold tracking-tight text-slate-100">
            CDN Link <span className="text-accent">Studio</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              pathname === "/" ? "text-accent" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Home
          </Link>
          <Link
            to="/generate"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              pathname === "/generate" ? "text-accent" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Studio
          </Link>
          <Link
            to="/seeder"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              pathname === "/seeder" ? "text-accent" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Seeder
          </Link>
          <Link to="/generate" className="btn-primary ml-2 !px-4 !py-2 text-xs sm:text-sm">
            Launch →
          </Link>
        </nav>
      </div>
    </header>
  );
}
