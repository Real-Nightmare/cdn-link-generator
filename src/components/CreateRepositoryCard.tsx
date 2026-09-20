import { useState } from "react";
import { SeedError, createRepository, isValidRepoName } from "../lib/seeder";
import { readStoredToken } from "../lib/settings";
import { Spinner } from "./ui";

/**
 * "✨ Create repository" card from the Repo Seeder page. Owns the form state
 * (name, description, visibility) and the create-repository API call; reports
 * outcomes through callbacks so the page keeps one activity log, one error
 * card, and can disable its other jobs while a creation is running.
 */
export function CreateRepositoryCard({
  busy,
  onBusyChange,
  onError,
  onLog,
  onCreated,
}: {
  /** True while another Seeder job (seed/commit/purge) is running. */
  busy: boolean;
  /** Tells the page a creation started/finished so it can disable other jobs. */
  onBusyChange: (creating: boolean) => void;
  /** Surfaces failures in the page's shared error card. */
  onError: (message: string | null) => void;
  /** Appends a timestamped line to the page's activity log. */
  onLog: (line: string) => void;
  /** Success: full_name + default branch, so the page can fill its target fields. */
  onCreated: (repo: { fullName: string; defaultBranch: string }) => void;
}) {
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [creating, setCreating] = useState(false);

  async function runCreateRepo() {
    if (busy || creating || !isValidRepoName(newRepoName.trim())) return;
    setCreating(true);
    onBusyChange(true);
    onError(null);
    try {
      const r = await createRepository(readStoredToken(), newRepoName.trim(), {
        description: newRepoDesc,
        isPrivate: newRepoPrivate,
      });
      // Land the new repo straight into the target fields, ready to seed.
      onCreated({ fullName: r.fullName, defaultBranch: r.defaultBranch });
      onLog(
        `✓ Created ${r.isPrivate ? "private" : "public"} repo ${r.fullName} (${r.htmlUrl}) — branch ${r.defaultBranch}`,
      );
    } catch (err) {
      const msg = err instanceof SeedError || err instanceof Error ? err.message : String(err);
      onError(msg);
      onLog(`✗ ${msg}`);
    } finally {
      setCreating(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-200">✨ Create repository</p>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-300">Repository name</label>
          <input
            value={newRepoName}
            onChange={(e) => setNewRepoName(e.target.value)}
            placeholder="my-svg-assets"
            spellCheck={false}
            className="input-base font-mono text-xs"
          />
          {newRepoName.trim().length > 0 && !isValidRepoName(newRepoName.trim()) && (
            <p className="mt-1 text-[11px] text-warn">Letters, numbers, dot, dash, underscore only</p>
          )}
        </div>
        <input
          value={newRepoDesc}
          onChange={(e) => setNewRepoDesc(e.target.value)}
          placeholder="description (optional)"
          className="input-base text-xs"
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => setNewRepoPrivate((p) => !p)}
            className={`chip text-[10px] hover:border-accent/50 hover:text-accent-soft ${newRepoPrivate ? "border-warn/50 text-warn" : "text-slate-400"}`}
            title="Private repos count against your account's private-repo quota"
          >
            {newRepoPrivate ? "🔒 private" : "🌍 public"}
          </button>
          <span className="text-[10px] text-slate-500">created on your account</span>
        </div>
        <button
          onClick={runCreateRepo}
          disabled={busy || creating || !isValidRepoName(newRepoName.trim())}
          className="btn-primary w-full py-2.5 text-sm"
        >
          {creating ? (
            <>
              <Spinner /> Creating…
            </>
          ) : (
            "Create repository"
          )}
        </button>
      </div>
    </div>
  );
}
