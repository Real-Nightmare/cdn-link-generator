import { useRef, useState } from "react";
import { CreateRepositoryCard } from "../components/CreateRepositoryCard";
import { SvgClonerCard } from "../components/SvgClonerCard";
import { ProgressBar, Spinner } from "../components/ui";
import { GitHubRepo, parseRepoURL } from "../lib/github";
import { readStoredToken } from "../lib/settings";
import {
  MAX_ARTIFICIAL_COMMITS,
  MAX_SEED_FILES,
  SeedError,
  autoFilePath,
  createArtificialCommits,
  purgeAutogen,
  runAutoCommit,
  seedSVG,
} from "../lib/seeder";

type Job = "idle" | "seeding" | "committing" | "purging";

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export default function Seeder() {
  const [repoText, setRepoText] = useState("");
  const [branch, setBranch] = useState("main");
  const [svg, setSvg] = useState("");
  const [count, setCount] = useState(100);
  const [flat, setFlat] = useState(false);
  const [commitCount, setCommitCount] = useState(10);
  const [commitMsg, setCommitMsg] = useState("chore: sync assets");
  const [fileBase, setFileBase] = useState("");
  const [commitBranch, setCommitBranch] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const abortRef = useRef(false);
  const [creating, setCreating] = useState(false);

  const [job, setJob] = useState<Job>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = job !== "idle" || creating;
  const parsed = (() => {
    try {
      const r = parseRepoURL(repoText);
      return { repo: r as GitHubRepo | null, invalid: false };
    } catch {
      return { repo: null, invalid: repoText.trim().length > 0 };
    }
  })();

  function addLog(line: string) {
    setLog((l) => [...l.slice(-200), `[${timestamp()}] ${line}`]);
  }

  function opts(shouldAbort?: () => boolean, branchOverride?: string) {
    return {
      token: readStoredToken(),
      branch: branchOverride ?? branch,
      onProgress: (done: number, total: number, label: string) => setProgress({ done, total, label }),
      shouldAbort,
    };
  }

  async function runSeed() {
    if (!parsed.repo || !svg.trim() || busy) return;
    setJob("seeding");
    setError(null);
    setLog([]);
    setProgress({ done: 0, total: count, label: "Starting…" });
    try {
      const res = await seedSVG(parsed.repo, svg, count, opts(), flat);
      addLog(`✓ Seeded ${res.files.toLocaleString()} files in ${res.commits} commit${res.commits === 1 ? "" : "s"}`);
    } catch (err) {
      const msg = err instanceof SeedError || err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog(`✗ ${msg}`);
    } finally {
      setJob("idle");
      setProgress(null);
    }
  }

  async function runCommits() {
    if (autoMode) return runAuto();
    if (!parsed.repo || busy) return;
    setJob("committing");
    setError(null);
    setLog([]);
    setProgress({ done: 0, total: commitCount, label: "Starting…" });
    try {
      const res = await createArtificialCommits(parsed.repo, commitCount, {
        ...opts(undefined, commitBranch.trim() || branch),
        message: commitMsg,
        baseName: fileBase.trim() || undefined,
      });
      addLog(`✓ ${res.created} artificial commits (${res.added} adds, ${res.removed} removes)`);
      if (res.branchCreated) addLog(`✓ Created new branch: ${commitBranch.trim()}`);
    } catch (err) {
      const msg = err instanceof SeedError || err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog(`✗ ${msg}`);
    } finally {
      setJob("idle");
      setProgress(null);
    }
  }

  /** Auto-commit mode: commits on a timer until Stop, the 50-cap, or an error. */
  async function runAuto() {
    if (!parsed.repo || busy) return;
    setJob("committing");
    setError(null);
    setLog([]);
    setProgress({ done: 0, total: MAX_ARTIFICIAL_COMMITS, label: "Starting auto commit…" });
    abortRef.current = false;
    try {
      const res = await runAutoCommit(parsed.repo, {
        ...opts(() => abortRef.current, commitBranch.trim() || branch),
        message: commitMsg,
        baseName: fileBase.trim() || undefined,
        intervalMs: intervalSec * 1000,
        onCommit: (n, kind, path, head) =>
          addLog(`${n}. ${kind === "add" ? "+" : "−"} ${path} → ${head.slice(0, 7)}`),
      });
      addLog(
        `✓ Auto commit run: ${res.created} commit${res.created === 1 ? "" : "s"} (${res.added} adds, ${res.removed} removes)`,
      );
      if (res.branchCreated) addLog(`✓ Created new branch: ${commitBranch.trim() || branch}`);
    } catch (err) {
      const msg = err instanceof SeedError || err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog(`✗ ${msg}`);
    } finally {
      setJob("idle");
      setProgress(null);
    }
  }


  async function runPurge() {
    if (!parsed.repo || busy) return;
    setJob("purging");
    setError(null);
    try {
      const n = await purgeAutogen(parsed.repo, opts(undefined, commitBranch.trim() || branch));
      addLog(`✓ Removed ${n} autogen file${n === 1 ? "" : "s"}`);
    } catch (err) {
      const msg = err instanceof SeedError || err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog(`✗ ${msg}`);
    } finally {
      setJob("idle");
    }
  }

  const svgValid = svg.trim().startsWith("<");
  const countValid = count >= 1 && count <= MAX_SEED_FILES;
  const commitsValid = commitCount >= 1 && commitCount <= MAX_ARTIFICIAL_COMMITS;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Repo Seeder</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste an SVG into any repo you can push to — up to {MAX_SEED_FILES.toLocaleString()} copies — or forge up
          to {MAX_ARTIFICIAL_COMMITS} artificial commits. Writes go straight from your browser to the GitHub API.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* Config */}
        <div className="card space-y-5 p-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">Target repository</label>
            <input
              value={repoText}
              onChange={(e) => setRepoText(e.target.value)}
              placeholder="owner/repo"
              spellCheck={false}
              className="input-base font-mono"
            />
            {parsed.invalid && <p className="mt-1.5 text-xs text-danger">Use the owner/repo format</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">Branch</label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              spellCheck={false}
              className="input-base font-mono"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              GitHub token <span className="text-slate-500">(from Link Studio — needs write access)</span>
            </label>
            <p className="text-xs text-slate-500">
              Saved token from the Link Studio page is reused. Make sure it has{" "}
              <span className="font-mono text-slate-400">Contents: read &amp; write</span> on this repo.
            </p>
          </div>

          {/* Create repository */}
          <CreateRepositoryCard
            busy={busy}
            onBusyChange={setCreating}
            onError={setError}
            onLog={addLog}
            onCreated={({ fullName, defaultBranch }) => {
              setRepoText(fullName);
              setBranch(defaultBranch);
            }}
          />

          {/* SVG Cloner — pick SVGs out of any repo; auto-forks when the
              token can't push to the source. */}
          <SvgClonerCard
            busy={busy}
            targetRepo={parsed.repo}
            branch={branch}
            onBusyChange={setCreating}
            onError={setError}
            onLog={addLog}
            onProgress={setProgress}
            onCloned={({ fullName }) => setRepoText(fullName)}
          />

          {/* Seed section */}
          <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-200">🌱 SVG Seeder</p>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">Your SVG</label>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-[11px] text-accent hover:text-accent-soft"
                  >
                    load file…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".svg,image/svg+xml"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setSvg(await f.text());
                    }}
                  />
                </div>
                <textarea
                  value={svg}
                  onChange={(e) => setSvg(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder="<svg xmlns=…> … </svg>"
                  className="input-base resize-y font-mono text-xs"
                />
                {!svgValid && svg.length > 0 && (
                  <p className="mt-1 text-[11px] text-warn">Doesn't look like SVG markup</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Copies: <span className="font-mono text-accent">{count.toLocaleString()}</span>
                  {count === MAX_SEED_FILES && <span className="ml-1 text-[10px] text-warn">(max)</span>}
                </label>
                <input
                  type="range"
                  min={1}
                  max={MAX_SEED_FILES}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full accent-accent-strong"
                />
                <div className="mt-1 flex gap-1.5">
                  {[10, 100, 1000, 10000].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      className="chip font-mono text-[10px] hover:border-accent/50 hover:text-accent-soft"
                    >
                      {n.toLocaleString()}
                    </button>
                  ))}
                  <button
                    onClick={() => setFlat((f) => !f)}
                    className={`chip ml-auto text-[10px] hover:border-accent/50 hover:text-accent-soft ${flat ? "border-accent/50 text-accent-soft" : ""}`}
                    title="Uncheck to nest 100 files per subfolder"
                  >
                    {flat ? "flat" : "seeded/"}
                  </button>
                </div>
              </div>
              <button
                onClick={runSeed}
                disabled={!parsed.repo || !svgValid || !countValid || busy}
                className="btn-primary w-full py-2.5 text-sm"
              >
                {job === "seeding" ? (
                  <>
                    <Spinner /> Seeding…
                  </>
                ) : (
                  `Seed ${count.toLocaleString()} cop${count === 1 ? "y" : "ies"}`
                )}
              </button>
            </div>
          </div>

          {/* Artificial commits */}
          <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-200">⏣ Artificial commits</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  Commits: <span className="font-mono text-accent">{commitCount}</span>
                  {commitCount === MAX_ARTIFICIAL_COMMITS && <span className="ml-1 text-[10px] text-warn">(max)</span>}
                </label>
                <input
                  type="range"
                  min={1}
                  max={MAX_ARTIFICIAL_COMMITS}
                  value={commitCount}
                  onChange={(e) => setCommitCount(Number(e.target.value))}
                  className="w-full accent-accent-strong"
                />
              </div>              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="commit message prefix"
                className="input-base text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-slate-300">File base name</label>
                  <input
                    value={fileBase}
                    onChange={(e) => setFileBase(e.target.value)}
                    placeholder="test"
                    spellCheck={false}
                    className="input-base font-mono text-xs"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    {autoFilePath(fileBase.trim() || undefined, 1)} …
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-slate-300">Commit branch</label>
                  <input
                    value={commitBranch}
                    onChange={(e) => setCommitBranch(e.target.value)}
                    placeholder={branch || "main"}
                    spellCheck={false}
                    className="input-base font-mono text-xs"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    {commitBranch.trim()
                      ? `commits to ${commitBranch.trim()} — created if missing`
                      : `uses “${branch || "main"}”`}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Commits alternate adding and deleting a tiny <span className="font-mono">.autogen/*.txt</span>{" "}
                marker — real history, real SHAs, as fast as the API allows.
              </p>

              {/* Auto-commit mode */}
              <div className="rounded border border-ink-700 bg-ink-900/60 p-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setAutoMode((a) => !a)}
                    className={`chip text-[10px] hover:border-accent/50 hover:text-accent-soft ${autoMode ? "border-accent/50 text-accent-soft" : "text-slate-400"}`}
                    title="Keep forging commits on a timer until you stop them"
                  >
                    {autoMode ? "⏵ auto-commit ON" : "⏸ auto-commit off"}
                  </button>
                  <span className="text-[10px] text-slate-500">stops at {MAX_ARTIFICIAL_COMMITS} max</span>
                </div>
                {autoMode && (
                  <div className="mt-2">
                    <label className="mb-1 block text-[11px] font-medium text-slate-300">
                      Interval: <span className="font-mono text-accent">{intervalSec}s</span> between commits
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={60}
                      value={intervalSec}
                      onChange={(e) => setIntervalSec(Number(e.target.value))}
                      className="w-full accent-accent-strong"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runCommits}
                  disabled={!parsed.repo || (!autoMode && !commitsValid) || busy}
                  className="btn-primary flex-1 py-2.5 text-sm"
                >
                  {job === "committing" ? (
                    <>
                      <Spinner /> {autoMode ? "Auto committing… (click Stop)" : "Committing…"}
                    </>
                  ) : autoMode ? (
                    "Start auto-commit"
                  ) : (
                    `Create ${commitCount}`
                  )}
                </button>
                {autoMode && job === "committing" ? (
                  <button
                    onClick={() => (abortRef.current = true)}
                    className="btn-secondary shrink-0 border-danger/50 px-4 text-danger hover:border-danger hover:text-danger"
                    title="Finish the current commit, then stop the timer"
                  >
                    ■ Stop
                  </button>
                ) : (
                  <button
                    onClick={runPurge}
                    disabled={!parsed.repo || busy}
                    className="btn-secondary shrink-0 px-3 py-2.5 text-xs"
                    title={`Delete every .autogen file on ${commitBranch.trim() || branch || "main"}`}
                  >
                    {job === "purging" ? <Spinner /> : "Purge .autogen"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Output */}
        <div className="space-y-5">
          {error && (
            <div className="card border-danger/40 bg-danger/5 p-5">
              <p className="font-semibold text-danger">Write failed</p>
              <p className="mt-1 text-sm text-slate-300">{error}</p>
            </div>
          )}
          {progress && (
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-mono text-slate-300">{progress.label}</span>
                <span className="font-mono text-xs text-slate-500">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <ProgressBar value={progress.done} total={progress.total} />
            </div>
          )}
          <div className="card min-h-[320px] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Activity</p>
            {log.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing yet — pick a repo, paste an SVG, and run a job. Results stream here.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto font-mono text-xs leading-relaxed text-slate-300">
                {log.map((l, i) => (
                  <p key={i} className={l.includes("✗") ? "text-danger" : l.includes("✓") ? "text-accent" : ""}>
                    {l}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
