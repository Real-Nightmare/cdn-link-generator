export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const tones: Record<string, string> = {
    default: "text-slate-100",
    good: "text-accent",
    bad: "text-danger",
    warn: "text-warn",
  };
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent-strong to-accent transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SectionHeading({
  kicker,
  title,
  sub,
}: {
  kicker?: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {kicker && (
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          {kicker}
        </p>
      )}
      <h2 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">{title}</h2>
      {sub && <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">{sub}</p>}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
