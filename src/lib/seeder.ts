// Repo seeder — browser-side GitHub write API. Two powers:
//
// 1. SVG Seeder: paste an SVG, choose a count (≤10,000), and it lands in the
//    target repo as that many files. Identical content is stored as ONE blob
//    and referenced by batched tree/commit API calls — no repeated uploads,
//    so 10,000 files cost the same bandwidth as one.
//
// 2. Artificial commits: create up to 50 extra commits that alternate adding
//    and removing a tiny `test-N.txt` marker file — synthetic history with
//    real SHAs, generated as fast as the GitHub API allows.
//
// All writes go through the standard GitHub Trees/Commits API with the
// user's token; only repos the token may push to will succeed.

import { GitHubRepo } from "./github";

export const MAX_SEED_FILES = 10_000;
export const MAX_ARTIFICIAL_COMMITS = 50;

const API = "https://api.github.com";

export class SeedError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "SeedError";
    this.status = status;
  }
}

interface Opts {
  token: string;
  branch?: string;
  message?: string;
  /** Artificial commits: base name for generated files (random when unset). */
  baseName?: string;
  onProgress?: (done: number, total: number, label: string) => void;
  shouldAbort?: () => boolean;
}

function check(res: Response, what: string): Response {
  // `what` names the failing endpoint for the error message.
  if (res.status === 401) throw new SeedError("Token invalid or expired", 401);
  if (res.status === 403) {
    throw new SeedError(
      "Token lacks write access to this repo (needs Contents: read & write) or hit a rate limit",
      403,
    );
  }
  if (res.status === 404) throw new SeedError(`Repo or ref not found for ${what}`, 404);
  if (res.status === 422) throw new SeedError(`GitHub rejected the ${what} (422 — check branch name)`, 422);
  if (!res.ok) throw new SeedError(`${what} failed (HTTP ${res.status})`, res.status);
  return res;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  // Label = the repo-relative endpoint, e.g. "git/blobs" — clearer than a raw URL.
  const label = path.split("?")[0].split("/").slice(3).join("/") || "request";
  check(res, label);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 0. Repository creation
// ---------------------------------------------------------------------------

export interface CreatedRepo {
  fullName: string; // owner/repo
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

/** Conservative subset of GitHub's repo-name rules — always a safe name. */
export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/.test(name) && !name.includes("..");
}

/**
 * Create a repository on the authenticated account (POST /user/repos).
 * `autoInit` (default true) seeds a README commit so the branch exists —
 * a fully empty repo has no ref for the Seeder to build on.
 */
export async function createRepository(
  token: string,
  name: string,
  opts: { description?: string; isPrivate?: boolean; autoInit?: boolean } = {},
): Promise<CreatedRepo> {
  if (!token) {
    throw new SeedError("No GitHub token saved — add one in Link Studio first (creating repos requires auth)");
  }
  const clean = name.trim();
  if (!isValidRepoName(clean)) throw new SeedError(`Invalid repository name: "${clean}"`);
  const res = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: clean,
      description: opts.description?.trim() || undefined,
      private: !!opts.isPrivate,
      auto_init: opts.autoInit !== false,
    }),
  });
  if (res.ok) {
    const r = (await res.json()) as {
      full_name: string;
      html_url: string;
      default_branch: string;
      private: boolean;
    };
    return {
      fullName: r.full_name,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch || "main",
      isPrivate: r.private,
    };
  }
  // Surface GitHub's own message (e.g. "name already exists on this account").
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) detail = ` — ${body.message}`;
  } catch {
    // non-JSON error body
  }
  if (res.status === 401) throw new SeedError("Token invalid or expired", 401);
  if (res.status === 403) {
    throw new SeedError(`Token can't create repos (needs the repo scope / Administration write)${detail}`, 403);
  }
  if (res.status === 422) throw new SeedError(`GitHub rejected the name${detail || " (already taken or invalid)"}`, 422);
  throw new SeedError(`Repo creation failed (HTTP ${res.status})${detail}`, res.status);
}

/** Read a repo ref and return its HEAD commit sha + tree sha. */
export async function getRef(repo: GitHubRepo, token: string, branch?: string) {
  // Branch names may contain slashes (feature/x) — pass raw, never encoded.
  const safeBranch = branchOf(branch);
  const ref = await api<{ object: { sha: string } }>(
    `/repos/${repo.owner}/${repo.name}/git/ref/heads/${safeBranch}`,
    token,
  );
  const headSha = ref.object.sha;
  // The git-commit object (not the REST commit) carries the tree sha.
  const commit = await api<{ tree: { sha: string } }>(
    `/repos/${repo.owner}/${repo.name}/git/commits/${headSha}`,
    token,
  );
  return { headSha, treeSha: commit.tree.sha };
}

async function createBlob(repo: GitHubRepo, token: string, content: string): Promise<string> {
  const b = await api<{ sha: string }>(`/repos/${repo.owner}/${repo.name}/git/blobs`, token, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  return b.sha;
}

interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string;
}

async function createTree(repo: GitHubRepo, token: string, baseTree: string, entries: TreeEntry[]) {
  const t = await api<{ sha: string }>(`/repos/${repo.owner}/${repo.name}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: entries }),
  });
  return t.sha;
}

async function createCommit(
  repo: GitHubRepo,
  token: string,
  message: string,
  tree: string,
  parents: string[],
): Promise<string> {
  const c = await api<{ sha: string }>(`/repos/${repo.owner}/${repo.name}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message, tree, parents }),
  });
  return c.sha;
}

async function updateRef(repo: GitHubRepo, token: string, branch: string | undefined, sha: string, force = false) {
  await api(`/repos/${repo.owner}/${repo.name}/git/refs/heads/${branchOf(branch)}`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha, force }),
  });
}

const pad4 = (n: number) => String(n).padStart(4, "0");

/** Branch field → usable ref name: trimmed, sanitized, never empty (falls
 * back to "main" so a cleared field can't 404 mid-run on `/refs/heads/`). */
const branchOf = (branch: string | undefined) =>
  (branch ?? "").trim().replace(/[^\w./-]/g, "") || "main";

// ---------------------------------------------------------------------------
// 1. SVG Seeder
// ---------------------------------------------------------------------------

export interface SeedPlan {
  /** Full paths, seeded order (padStart keeps file managers sorted). */
  paths: string[];
  blobSha: string;
  dir: string;
  base: string;
  ext: string;
}

/** Common plan: one blob, deterministic paths. */
async function planSeed(
  repo: GitHubRepo,
  svg: string,
  count: number,
  opts: Opts,
  dir: string,
  base: string,
  names: (i: number, base: string, ext: string) => string,
): Promise<SeedPlan> {
  opts.onProgress?.(0, count, "Uploading SVG blob…");
  const blobSha = await createBlob(repo, opts.token, svg);
  const m = base.match(/^(.*?)(\.svg)?$/i);
  const stem = m?.[1] ?? base;
  const ext = m?.[2]?.toLowerCase() ?? ".svg";
  const paths: string[] = [];
  for (let i = 1; i <= count; i++) paths.push(`${dir}${names(i, stem, ext)}`);
  return { paths, blobSha, dir, base, ext };
}

/**
 * Seed the same SVG `count` times into `repo` (≤10,000). Identical content →
 * one blob, referenced by every tree entry. Commits are batched (500 files
 * each) so 10,000 files = 1 blob + 20 trees/commits + 20 ref updates.
 * `flat` false nests 100 SVGs per subfolder (easier to browse).
 */
export async function seedSVG(
  repo: GitHubRepo,
  svg: string,
  count: number,
  opts: Opts,
  flat = false,
): Promise<{ files: number; commits: number }> {
  if (count < 1 || count > MAX_SEED_FILES) {
    throw new SeedError(`Count must be between 1 and ${MAX_SEED_FILES.toLocaleString()}`);
  }
  const { headSha, treeSha } = await getRef(repo, opts.token, opts.branch);
  const dir = flat ? "" : "seeded/";
  const plan = await planSeed(repo, svg, count, opts, dir, "icon.svg", (i, stem, ext) => `${stem}-${pad4(i)}${ext}`);

  const BATCH = 500;
  const batches = Math.ceil(count / BATCH);
  let head = headSha;
  let tree = treeSha;
  let filesDone = 0;

  for (let b = 0; b < batches; b++) {
    if (opts.shouldAbort?.()) break;
    const entries: TreeEntry[] = [];
    const lo = b * BATCH;
    const hi = Math.min(lo + BATCH, count);
    for (let i = lo; i < hi; i++) {
      entries.push({ path: plan.paths[i], mode: "100644", type: "blob", sha: plan.blobSha });
    }
    opts.onProgress?.(filesDone, count, `Commit ${b + 1}/${batches}: adding ${entries.length} files…`);
    tree = await createTree(repo, opts.token, tree, entries);
    head = await createCommit(repo, opts.token, `seed: add ${entries.length} SVGs (${lo + 1}–${hi})`, tree, [head]);
    await updateRef(repo, opts.token, opts.branch, head);
    filesDone += entries.length;
    opts.onProgress?.(filesDone, count, `Added ${filesDone}/${count} files…`);
    if (b < batches - 1) await sleep(400); // gentle on the API
  }
  return { files: filesDone, commits: batches };
}

// ---------------------------------------------------------------------------
// 2. Artificial commits
// ---------------------------------------------------------------------------

/**
 * Path of the artificial commits' marker file: `.autogen/test-0001.txt`,
 * `-0002`, … — sequential, so every add is a unique blob. A custom base name
 * replaces the `test` stem; the extension stays `.txt` and the content is one
 * line, because the point is the commit history, not the files themselves.
 */
export function autoFilePath(base: string | undefined, n: number): string {
  const stem =
    (base ?? "")
      .trim()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "test";
  return `.autogen/${stem}-${pad4(n)}.txt`;
}

async function getDefaultBranchHead(repo: GitHubRepo, token: string): Promise<string> {
  const info = await api<{ default_branch: string }>(`/repos/${repo.owner}/${repo.name}`, token);
  const ref = await api<{ object: { sha: string } }>(
    `/repos/${repo.owner}/${repo.name}/git/ref/heads/${info.default_branch}`,
    token,
  );
  return ref.object.sha;
}

/** Create `branch` pointing at `fromSha` — same sanitization as getRef/updateRef. */
async function createBranch(repo: GitHubRepo, token: string, branch: string, fromSha: string) {
  const name = branch.replace(/[^\w./-]/g, "");
  if (!name || name.includes("..") || name.endsWith(".lock") || name.endsWith("/")) {
    throw new SeedError(`Invalid branch name: "${branch}"`);
  }
  await api(`/repos/${repo.owner}/${repo.name}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
  });
}

/** Result of a batch or auto run of artificial commits. */
export interface AutoCommitResult {
  created: number;
  added: number;
  removed: number;
  branchCreated: boolean;
}

/**
 * Mutable cursor for a run of artificial commits: where the commit chain
 * points and what this run has created so far (candidates for removal).
 */
interface CommitCursor {
  head: string;
  tree: string;
  live: string[];
  added: number;
  removed: number;
}

/** Shared setup: resolve the branch ref, auto-creating it when missing. */
async function resolveBranchRef(
  repo: GitHubRepo,
  opts: Opts,
  plannedTotal: number,
): Promise<{ headSha: string; treeSha: string; branchCreated: boolean }> {
  try {
    const { headSha, treeSha } = await getRef(repo, opts.token, opts.branch);
    return { headSha, treeSha, branchCreated: false };
  } catch (err) {
    if (!(err instanceof SeedError) || err.status !== 404) throw err;
    const name = branchOf(opts.branch);
    opts.onProgress?.(0, plannedTotal, `Branch "${name}" not found — creating from the default branch…`);
    await createBranch(repo, opts.token, name, await getDefaultBranchHead(repo, opts.token));
    const { headSha, treeSha } = await getRef(repo, opts.token, name);
    return { headSha, treeSha, branchCreated: true };
  }
}

/**
 * One artificial-commit step: ADD a tiny `.autogen/test-N.txt` marker (one-line
 * "commit N" content — cheap, unique blob) or REMOVE the marker added earlier.
 * The two alternate, so a run leaves no junk behind and only every other
 * commit costs a blob upload. Then tree → commit → ref update, advancing
 * `cursor` in place — no artificial pauses; speed is bounded only by the API
 * round-trips. Shared by createArtificialCommits (batch) and runAutoCommit.
 */
async function autoCommitStep(
  repo: GitHubRepo,
  cursor: CommitCursor,
  opts: Opts,
  n: number,
): Promise<{ kind: "add" | "remove"; path: string; head: string }> {
  const entries: TreeEntry[] = [];
  const add = cursor.live.length === 0; // alternate: add → remove → add …
  let path: string;
  if (add) {
    path = autoFilePath(opts.baseName, n);
    const blob = await createBlob(repo, opts.token, `commit ${n}`);
    entries.push({ path, mode: "100644", type: "blob", sha: blob });
    cursor.live.push(path);
    cursor.added++;
  } else {
    path = cursor.live.splice(Math.floor(Math.random() * cursor.live.length), 1)[0];
    entries.push({ path, mode: "100644", type: "blob", sha: null as unknown as string });
    cursor.removed++;
  }
  cursor.tree = await createTree(repo, opts.token, cursor.tree, entries);
  cursor.head = await createCommit(
    repo,
    opts.token,
    opts.message ?? (add ? "chore: add test marker" : "chore: remove test marker"),
    cursor.tree,
    [cursor.head],
  );
  await updateRef(repo, opts.token, opts.branch, cursor.head);
  return { kind: add ? "add" : "remove", path, head: cursor.head };
}

/**
 * Create `count` artificial commits (≤50) as fast as the GitHub API allows.
 * Commits alternate: ADD a tiny `.autogen/test-N.txt` marker (`{base}-N.txt`
 * when `opts.baseName` is set), then REMOVE it — so a run of any size ends
 * with the branch clean. A branch that doesn't exist yet is created from the
 * repo's default branch.
 */
export async function createArtificialCommits(
  repo: GitHubRepo,
  count: number,
  opts: Opts,
): Promise<AutoCommitResult> {
  if (count < 1 || count > MAX_ARTIFICIAL_COMMITS) {
    throw new SeedError(`Commits must be between 1 and ${MAX_ARTIFICIAL_COMMITS}`);
  }
  const { headSha, treeSha, branchCreated } = await resolveBranchRef(repo, opts, count);
  const cursor: CommitCursor = {
    head: headSha,
    tree: treeSha,
    live: [], // marker files this run created (candidates for removal)
    added: 0,
    removed: 0,
  };

  for (let i = 1; i <= count; i++) {
    if (opts.shouldAbort?.()) break;
    opts.onProgress?.(i - 1, count, `Artificial commit ${i}/${count}…`);
    await autoCommitStep(repo, cursor, opts, i);
  }
  return { created: cursor.added + cursor.removed, added: cursor.added, removed: cursor.removed, branchCreated };
}

/** Sleep that wakes early once `shouldAbort` turns true (checked every 250ms). */
async function sleepInterruptible(ms: number, shouldAbort?: () => boolean): Promise<void> {
  const STEP = 250;
  for (let waited = 0; waited < ms; waited += STEP) {
    if (shouldAbort?.()) return;
    await sleep(Math.min(STEP, ms - waited));
  }
}

export interface AutoCommitOpts extends Opts {
  /** Pause between commits, ms (clamped to ≥1s; default 5s). */
  intervalMs?: number;
  /** Called after each committed step — used by the UI's live log. */
  onCommit?: (n: number, kind: "add" | "remove", path: string, head: string) => void;
}

/**
 * Auto-commit mode: keep forging commits on a timer until stopped
 * (`shouldAbort`), the per-run cap (MAX_ARTIFICIAL_COMMITS) is hit, or an
 * error occurs. Loop-with-sleep rather than setInterval, so runs can never
 * overlap, abort is checked between steps, and the API is never hammered.
 */
export async function runAutoCommit(repo: GitHubRepo, opts: AutoCommitOpts): Promise<AutoCommitResult> {
  const intervalMs = Math.max(1_000, opts.intervalMs ?? 5_000);
  const { headSha, treeSha, branchCreated } = await resolveBranchRef(repo, opts, MAX_ARTIFICIAL_COMMITS);
  const cursor: CommitCursor = {
    head: headSha,
    tree: treeSha,
    live: [],
    added: 0,
    removed: 0,
  };

  for (let i = 1; i <= MAX_ARTIFICIAL_COMMITS; i++) {
    if (opts.shouldAbort?.()) break;
    opts.onProgress?.(i - 1, MAX_ARTIFICIAL_COMMITS, `Auto commit ${i}/${MAX_ARTIFICIAL_COMMITS}…`);
    const step = await autoCommitStep(repo, cursor, opts, i);
    opts.onCommit?.(i, step.kind, step.path, step.head);
    if (i < MAX_ARTIFICIAL_COMMITS) {
      opts.onProgress?.(i, MAX_ARTIFICIAL_COMMITS, `Next auto commit in ${Math.round(intervalMs / 1000)}s…`);
      await sleepInterruptible(intervalMs, opts.shouldAbort);
    }
  }
  return { created: cursor.added + cursor.removed, added: cursor.added, removed: cursor.removed, branchCreated };
}

/** Delete every .autogen/ file the artificial commits created (cleanup). */
// ---------------------------------------------------------------------------
// 3. SVG cloner — copy selected SVGs from any source repo into a writable one
// ---------------------------------------------------------------------------

import type { RepoFile } from "./github";

export interface CloneSvgsResult {
  cloned: number;
  failed: { path: string; error: string }[];
}

/**
 * Clone the selected SVGs from `source` into `target` (the target must be
 * writable by the token — pass a fork when the source isn't). Blob SHAs from
 * the source tree scan are reused when possible (no re-upload); missing SHAs
 * fall back to fetching content. Files land under `cloned/` in ONE commit per
 * batch (fast, no history spam).
 */
export async function cloneSvgs(
  source: { repo: GitHubRepo; files: RepoFile[] },
  target: GitHubRepo,
  opts: Opts,
  destDir = "cloned",
): Promise<CloneSvgsResult> {
  if (source.files.length === 0) throw new SeedError("No SVGs selected to clone");
  const { headSha, treeSha } = await getRef(target, opts.token, opts.branch);

  // Target repo stores the same git objects — a source blob SHA resolves as-is.
  // (Git SHAs are content-addressed, so identical content = identical SHA.)
  const entries: { path: string; sha: string }[] = [];
  const needContent: RepoFile[] = [];
  const seen = new Set<string>();
  for (const f of source.files) {
    if (f.sha) {
      if (!seen.has(f.sha)) {
        entries.push({ path: `${destDir}/${f.path.split("/").pop()}`, sha: f.sha });
        seen.add(f.sha);
      }
    } else {
      needContent.push(f);
    }
  }

  let head = headSha;
  let tree = treeSha;
  const failed: { path: string; error: string }[] = [];
  let done = 0;
  const total = source.files.length;

  // Blobs without SHAs: fetch each file's content and upload.
  for (const f of needContent) {
    if (opts.shouldAbort?.()) break;
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${source.repo.owner}/${source.repo.name}/contents/${f.path}`,
        { headers: { Accept: "application/vnd.github.raw+json", ...(opts.token ? { Authorization: `token ${opts.token}` } : {}) } },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const sha = await createBlob(target, opts.token, text);
      entries.push({ path: `${destDir}/${f.path.split("/").pop()}`, sha });
    } catch (err) {
      failed.push({ path: f.path, error: err instanceof Error ? err.message : String(err) });
    }
    done++;
    opts.onProgress?.(done, total, `Fetched ${done}/${total} files without SHAs…`);
  }

  if (entries.length === 0) {
    throw new SeedError(`Nothing could be cloned${failed.length ? ` — ${failed.length} file(s) failed` : ""}`);
  }

  // One tree+commit for everything (bounded in case of very large selections).
  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    if (opts.shouldAbort?.()) break;
    const batch = entries.slice(i, i + BATCH);
    opts.onProgress?.(done, total, `Committing ${batch.length} cloned files…`);
    tree = await createTree(target, opts.token, tree, batch.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha })));
    head = await createCommit(target, opts.token, `clone: add ${batch.length} SVGs from ${source.repo.owner}/${source.repo.name}`, tree, [head]);
    await updateRef(target, opts.token, opts.branch, head);
    done += batch.length;
    opts.onProgress?.(Math.min(done, total), total, `Cloned ${Math.min(done, total)}/${total} files…`);
    if (i + BATCH < entries.length) await sleep(400);
  }

  return { cloned: entries.length, failed };
}

export async function purgeAutogen(repo: GitHubRepo, opts: Opts): Promise<number> {
  const { headSha, treeSha } = await getRef(repo, opts.token, opts.branch);
  const filesRes = await fetch(
    `${API}/repos/${repo.owner}/${repo.name}/git/trees/${treeSha}?recursive=1`,
    { headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/vnd.github+json" } },
  );
  check(filesRes, "tree read");
  const tree = (await filesRes.json()) as { tree?: { path: string; type: string }[] };
  const targets = (tree.tree ?? []).filter((f) => f.type === "blob" && f.path.startsWith(".autogen/"));
  if (targets.length === 0) return 0;
  const entries: TreeEntry[] = targets.map((f) => ({
    path: f.path,
    mode: "100644",
    type: "blob",
    sha: null as unknown as string,
  }));
  const newTree = await createTree(repo, opts.token, treeSha, entries);
  const commit = await createCommit(repo, opts.token, "chore: remove autogen assets", newTree, [headSha]);
  await updateRef(repo, opts.token, opts.branch, commit);
  return targets.length;
}
