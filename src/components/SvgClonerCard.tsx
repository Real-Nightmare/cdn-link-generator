import { useState } from "react";
import { Spinner } from "./ui";
import {
  checkWriteAccess,
  forkRepository,
  getSVGFiles,
  type GitHubRepo,
  type RepoFile,
} from "../lib/github";
import { cloneSvgs } from "../lib/seeder";
import { readStoredToken } from "../lib/settings";

/** Shown checkboxes per scan — huge repos stay usable; the counter and
 * select-all still cover every SVG found. */
const MAX_CHECKBOXES = 100;

/**
 * 📎 SVG Cloner — pick SVGs straight out of any repo and clone them into the
 * target. If the token can't push to the source (different account), the card
 * offers to fork it first and clones from the fork instead.
 */
export function SvgClonerCard({
  busy,
  targetRepo,
  branch,
  onBusyChange,
  onError,
  onLog,
  onProgress,
  onCloned,
}: {
  busy: boolean;
  targetRepo: GitHubRepo | null;
  branch: string;
  onBusyChange: (b: boolean) => void;
  onError: (msg: string | null) => void;
  onLog: (line: string) => void;
  onProgress: (p: { done: number; total: number; label: string } | null) => void;
  /** Target fields are refilled with the fork's owner/name after a fork+clone. */
  onCloned?: (repo: { fullName: string; branch: string }) => void;
}) {
  const [sourceText, setSourceText] = useState("");
  const [scan, setScan] = useState<{ repo: GitHubRepo; files: RepoFile[]; truncated: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [access, setAccess] = useState<"unknown" | "checking" | "writable" | "readonly">("unknown");
  const [scanError, setScanError] = useState<string | null>(null);

  const shown = scan?.files.slice(0, MAX_CHECKBOXES) ?? [];
  const allSelected = scan ? selected.size === scan.files.length && scan.files.length > 0 : false;

  function parseSource(): GitHubRepo | null {
    const s = sourceText.trim();
    if (!s) return null;
    const cleaned = s.replace(/^https?:\/\/github\.com\//i, "").replace(/^github\.com\//i, "").replace(/\.git$/i, "");
    const [owner, name] = cleaned.split("/");
    return owner && name ? { owner, name: name.replace(/\.git$/i, "") } : null;
  }

  async function runScan() {
    const repo = parseSource();
    if (!repo || scanning) return;
    setScanning(true);
    setScanError(null);
    setScan(null);
    setSelected(new Set());
    setAccess("checking");
    onBusyChange(true);
    try {
      const token = readStoredToken();
      const res = await getSVGFiles(repo, token || undefined);
      setScan({ repo, files: res.tree, truncated: res.truncated });
      if (res.tree.length === 0) onLog(`⚠ ${repo.owner}/${repo.name} contains no .svg files`);
      else onLog(`✓ Found ${res.tree.length} SVG${res.tree.length === 1 ? "" : "s"} in ${repo.owner}/${repo.name}${res.truncated ? " (tree truncated)" : ""}`);
      // Push check decides whether cloning needs a fork first.
      if (token) {
        try {
          const push = await checkWriteAccess(repo, token);
          setAccess(push ? "writable" : "readonly");
        } catch {
          setAccess("readonly");
        }
      } else {
        setAccess("readonly");
        onLog("⚠ No token saved — cloning needs a token and a writable target");
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      onBusyChange(false);
    }
  }

  function toggle(path: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    if (!scan) return;
    setSelected(allSelected ? new Set() : new Set(scan.files.map((f) => f.path)));
  }

  /** Clone flow: fork first when readonly, then one batched commit. */
  async function runClone() {
    if (!scan || selected.size === 0 || cloning || busy) return;
    setCloning(true);
    onBusyChange(true);
    onError(null);
    onProgress({ done: 0, total: selected.size, label: "Preparing clone…" });
    const token = readStoredToken();
    try {
      let sourceRepo = scan.repo;
      const target = targetRepo;

      // Source not writable → fork it into the token's account and clone from
      // the fork (same git objects, so blob SHAs still resolve).
      if (access === "readonly" && token) {
        const fork = await forkRepository(scan.repo, token, (label) => onProgress({ done: 0, total: selected.size, label }));
        onLog(`✓ Forked ${scan.repo.owner}/${scan.repo.name} → ${fork.fullName}`);
        sourceRepo = { owner: fork.fullName.split("/")[0], name: fork.fullName.split("/")[1] };
      }

      if (!target) throw new Error("Set a target repository first (the clone lands there)");

      const picks = scan.files.filter((f) => selected.has(f.path));
      // When cloning from a freshly created fork, blob SHAs are identical —
      // pass the picks as-is; the SHAs are content-addressed and still resolve.
      const res = await cloneSvgs({ repo: sourceRepo, files: picks }, target, {
        token,
        branch,
        onProgress: (done, total, label) => onProgress({ done, total, label }),
      });
      onLog(`✓ Cloned ${res.cloned} SVG${res.cloned === 1 ? "" : "s"} into ${target.owner}/${target.name} (${branch})`);
      for (const f of res.failed.slice(0, 5)) onLog(`✗ ${f.path}: ${f.error}`);
      if (res.failed.length > 5) onLog(`✗ …and ${res.failed.length - 5} more failures`);
      onCloned?.({ fullName: `${target.owner}/${target.name}`, branch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError(msg);
      onLog(`✗ ${msg}`);
    } finally {
      setCloning(false);
      onBusyChange(false);
      onProgress(null);
    }
  }

  const source = parseSource();

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-4">
      <p className="mb-1 text-sm font-semibold text-slate-200">📎 SVG Cloner</p>
      <p className="mb-3 text-[11px] text-slate-500">
        Pick SVGs from any repo and clone them into the target. Can't push to the source? It forks it for you.
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-slate-300">Source repository</label>
          <div className="flex gap-2">
            <input
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="owner/repo (the SVGs come from here)"
              spellCheck={false}
              className="input-base font-mono text-xs"
            />
            <button
              onClick={runScan}
              disabled={!source || scanning || busy}
              className="btn-secondary shrink-0 px-3 text-xs"
              title="Scan the repo for .svg files"
            >
              {scanning ? <Spinner /> : "Scan"}
            </button>
          </div>
          {access === "readonly" && scan && (
            <p className="mt-1.5 text-[11px] text-warn">
              ⚠ No push access to {scan.repo.owner}/{scan.repo.name} — the clone will fork it to your account first.
            </p>
          )}
          {access === "writable" && scan && (
            <p className="mt-1.5 text-[11px] text-accent-soft">✓ Token can push to this repo — cloning straight from it.</p>
          )}
        </div>

        {scanError && <p className="text-xs text-danger">✗ {scanError}</p>}

        {scan && scan.files.length > 0 && (
          <div className="rounded border border-ink-700 bg-ink-900/60">
            <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-accent-strong" />
                Select all ({scan.files.length})
              </label>
              <span className="font-mono text-[10px] text-slate-500">{selected.size} selected</span>
            </div>
            <div className="max-h-44 overflow-y-auto px-3 py-2">
              {shown.map((f) => (
                <label key={f.path} className="flex items-center gap-2 py-0.5 font-mono text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    className="accent-accent-strong"
                  />
                  <span className="truncate" title={f.path}>
                    {f.path}
                  </span>
                </label>
              ))}
              {scan.files.length > shown.length && (
                <p className="mt-1 text-[10px] text-slate-500">
                  …and {(scan.files.length - shown.length).toLocaleString()} more — use Select all to include them.
                </p>
              )}
            </div>
          </div>
        )}

        <button
          onClick={runClone}
          disabled={!scan || selected.size === 0 || !targetRepo || cloning || busy}
          className="btn-primary w-full py-2.5 text-sm"
          title={targetRepo ? `Clone ${selected.size} SVGs into ${targetRepo.owner}/${targetRepo.name}` : "Set a target repository first"}
        >
          {cloning ? (
            <>
              <Spinner /> Cloning…
            </>
          ) : (
            `Clone ${selected.size} SVG${selected.size === 1 ? "" : "s"} → target`
          )}
        </button>
      </div>
    </div>
  );
}
