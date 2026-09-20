// GitHub API client — ported from the CLI's github.go, browser edition.
// Runs entirely client-side; the token (optional) stays in the user's browser.
// Also hosts the jsDelivr Data API client for npm package mode.

export interface GitHubRepo {
  owner: string;
  name: string;
}

export interface RepoFile {
  path: string;
  type: string;
  size: number;
}

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

const API_BASE = "https://api.github.com";
const JSDELIVR_DATA = "https://data.jsdelivr.com/v1";

/** Parse "owner/repo", with or without a github.com prefix. */
export function parseRepoURL(repoStr: string): GitHubRepo {
  let s = repoStr.trim().replace(/\.git$/, "").trim();
  for (const prefix of ["https://github.com/", "http://github.com/", "github.com/"]) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  const parts = s.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitHubError('Invalid repo format — use "owner/repo"');
  }
  return { owner: parts[0], name: parts[1] };
}

interface FetchOpts {
  method?: string;
  token?: string;
}

async function ghFetch(path: string, opts: FetchOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (opts.token) headers.Authorization = `token ${opts.token}`;
  return fetch(API_BASE + path, { method: opts.method ?? "GET", headers });
}

/** Request with retry on transient network/5xx failures. */
async function ghFetchRetry(path: string, opts: FetchOpts = {}): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 750));
    try {
      const resp = await ghFetch(path, opts);
      if (resp.status >= 500) {
        lastErr = new GitHubError(`GitHub server error (HTTP ${resp.status})`, resp.status);
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof GitHubError) throw lastErr;
  throw new GitHubError(
    "Network error reaching GitHub (check connection, VPN or extensions blocking api.github.com)",
  );
}

/** Scan a repo recursively for .svg files via the Git Trees API (one request). */
export async function getSVGFiles(repo: GitHubRepo, token?: string): Promise<{
  files: string[];
  truncated: boolean;
}> {
  const resp = await ghFetchRetry(`/repos/${repo.owner}/${repo.name}/git/trees/HEAD?recursive=1`, {
    token,
  });

  switch (resp.status) {
    case 200:
      break;
    case 404:
      throw new GitHubError("Repo not found — check the name (and token scope if private)", 404);
    case 401:
      throw new GitHubError("Token is invalid or expired", 401);
    case 403: {
      const body = await resp.text().catch(() => "");
      if (body.includes("rate limit")) {
        throw new GitHubError("GitHub API rate limit exceeded — add a token to raise the limit", 403);
      }
      throw new GitHubError("Access forbidden (HTTP 403)", 403);
    }
    default:
      throw new GitHubError(`GitHub API error (HTTP ${resp.status})`, resp.status);
  }

  const tree = (await resp.json()) as { tree?: RepoFile[]; truncated?: boolean };
  const files = (tree.tree ?? [])
    .filter((f) => f.type === "blob" && f.path.toLowerCase().endsWith(".svg"))
    .map((f) => f.path);
  return { files, truncated: tree.truncated === true };
}

/**
 * Fetch the file tree of ONE commit (paths of blobs only).
 * Empty trees (no tree entry) throw — callers treat that as "no SVGs here".
 */
export async function getTreeForCommit(
  repo: GitHubRepo,
  sha: string,
  token?: string,
): Promise<Set<string>> {
  const resp = await ghFetchRetry(
    `/repos/${repo.owner}/${repo.name}/git/trees/${sha}?recursive=1`,
    { token },
  );
  if (!resp.ok) throw new GitHubError(`Tree fetch failed for ${sha.slice(0, 7)} (HTTP ${resp.status})`, resp.status);
  const tree = (await resp.json()) as { tree?: RepoFile[] };
  return new Set((tree.tree ?? []).filter((f) => f.type === "blob").map((f) => f.path));
}

/**
 * SMART generation: fetch each commit's tree (bounded concurrency) and return
 * a Map of commit → Set of SVG paths actually present at that commit. Old
 * commits only get an SVG link if that SVG existed at the time — no more 404
 * links for files that were added later or deleted since.
 */
export async function getCommitTrees(
  repo: GitHubRepo,
  shas: string[],
  token?: string,
  parallel = false,
  onProgress?: (done: number) => void,
  shouldAbort?: () => boolean,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  let done = 0;
  if (!parallel) {
    for (const sha of shas) {
      if (shouldAbort?.()) break;
      try {
        out.set(sha, await getTreeForCommit(repo, sha, token));
      } catch {
        /* commit unreachable — no links from it */
      }
      done++;
      onProgress?.(done);
    }
    return out;
  }
  // Parallel fetch (rate-limit aware) — tiny binary semaphore.
  let inFlight = 0;
  let waiters: (() => void)[] = [];
  const waitForSlot = () => new Promise<void>((r) => waiters.push(r));
  const release = () => {
    const w = waiters;
    waiters = [];
    w.forEach((w2) => w2());
  };
  await Promise.all(
    shas.map(async (sha) => {
      while (inFlight >= 6) {
        if (shouldAbort?.()) return;
        await waitForSlot();
      }
      if (shouldAbort?.()) return;
      inFlight++;
      try {
        out.set(sha, await getTreeForCommit(repo, sha, token));
      } catch {
        /* commit unreachable — no links from it */
      } finally {
        inFlight--;
        release();
      }
      done++;
      onProgress?.(done);
    }),
  );
  return out;
}

/** List real commit SHAs from the repo's history (newest first). */
export async function getCommitSHAs(
  repo: GitHubRepo,
  count: number,
  token?: string,
): Promise<string[]> {
  const perPage = Math.min(Math.max(count, 1), 100);
  const resp = await ghFetchRetry(`/repos/${repo.owner}/${repo.name}/commits?per_page=${perPage}`, {
    token,
  });
  if (!resp.ok) {
    throw new GitHubError(`Failed to list commits (HTTP ${resp.status})`, resp.status);
  }
  const commits = (await resp.json()) as { sha: string }[];
  return commits.map((c) => c.sha);
}

/** Verify a token and return the login it belongs to. */
export async function verifyToken(token: string): Promise<string> {
  const resp = await ghFetch("/user", { token });
  if (resp.status === 401) throw new GitHubError("Token is invalid or expired", 401);
  if (!resp.ok) throw new GitHubError(`Unexpected response (HTTP ${resp.status})`, resp.status);
  const user = (await resp.json()) as { login?: string };
  return user.login ?? "unknown";
}

/** Fetch core rate-limit info (optionally authenticated). */
export async function getRateLimit(token?: string): Promise<{
  remaining: number;
  limit: number;
}> {
  const resp = await ghFetch("/rate_limit", { token });
  if (!resp.ok) throw new GitHubError(`Rate limit check failed (HTTP ${resp.status})`);
  const rl = (await resp.json()) as {
    resources: { core: { remaining: number; limit: number } };
  };
  return { remaining: rl.resources.core.remaining, limit: rl.resources.core.limit };
}

// ---------------------------------------------------------------------------
// GitHub Pages — status probe + one-click enable
// ---------------------------------------------------------------------------

export interface PagesInfo {
  url: string;
  status: string;
}

/**
 * Whether the repo has GitHub Pages enabled (GET /pages → 404 when off).
 * Public repos can be probed anonymously; a token extends this to private
 * repos the user can see. Admin scope is only needed to turn Pages on.
 */
export async function getPagesInfo(repo: GitHubRepo, token?: string): Promise<PagesInfo | null> {
  const resp = await ghFetchRetry(`/repos/${repo.owner}/${repo.name}/pages`, { token });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new GitHubError(`Pages check failed (HTTP ${resp.status})`, resp.status);
  const p = (await resp.json()) as { html_url?: string; status?: string };
  return {
    url: p.html_url ?? `https://${repo.owner}.github.io/${repo.name}/`,
    status: p.status ?? "unknown",
  };
}

/**
 * Enable Pages on {owner}/{repo}: build from the repo's default branch at
 * root, then read back the resulting URL. Needs a token with
 * `administration: write` (a plain public probe won't do).
 */
export async function enablePages(repo: GitHubRepo, token?: string): Promise<PagesInfo> {
  if (!token) {
    throw new GitHubError("A GitHub token is required to enable Pages (needs administration: write)");
  }
  const branchRes = await ghFetchRetry(`/repos/${repo.owner}/${repo.name}`, { token });
  if (!branchRes.ok) throw new GitHubError("Repo not found — check the name (and token scope if private)", 404);
  const repoInfo = (await branchRes.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch || "main";

  const resp = await fetch(`${API_BASE}/repos/${repo.owner}/${repo.name}/pages`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      source: { branch, path: "/" },
      build_type: "legacy",
    }),
  });
  if (resp.status === 409) {
    throw new GitHubError("Pages exists but is still initializing — retry in a moment", 409);
  }
  if (resp.status === 401) throw new GitHubError("Token is invalid or expired", 401);
  if (resp.status === 403) {
    throw new GitHubError("Token lacks permission to enable Pages (needs administration: write)", 403);
  }
  if (!resp.ok) {
    let detail = "";
    try {
      const body = (await resp.json()) as { message?: string };
      if (body.message) detail = ` — ${body.message}`;
    } catch {
      // non-JSON error body
    }
    throw new GitHubError(`Enabling Pages failed (HTTP ${resp.status})${detail}`, resp.status);
  }
  const p = (await resp.json()) as { html_url?: string; status?: string };
  return {
    url: p.html_url ?? `https://${repo.owner}.github.io/${repo.name}/`,
    status: p.status ?? "building",
  };
}

export const MAX_VALIDATE_WORKERS = 512;
const VALIDATE_TIMEOUT_MS = 8000;

/** True when a URL is structurally impossible to serve — fail these instantly
 * without burning a network request. */
export function isPlausibleUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname;
  if (!h || !h.includes(".") || h.includes(" ")) return false; // no bare/empty hosts
  if (u.pathname.length < 2) return false; // no bare-domain "links"
  if (/[#?]/.test(h)) return false;
  return true;
}

/** One fetch attempt with a hard timeout; null = network/CORS/timeout failure. */
async function timedFetch(url: string, method: "HEAD" | "GET"): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method, mode: "cors", cache: "no-store", signal: ctrl.signal });
    return resp.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Check one URL with HEAD (fallback GET), returns status or 0 on failure. */
export async function checkLink(url: string): Promise<number> {
  const head = await timedFetch(url, "HEAD");
  if (head !== null && head !== 405) return head;
  const get = await timedFetch(url, "GET");
  return get ?? 0;
}

/**
 * Validate ALL links at once — the concurrency slider caps in-flight HEAD
 * requests (browser network saturation), while the CPU-side work (format
 * pre-flight, status classification, result assembly) is fully parallel via
 * Promise.all so it saturates every core instead of dribbling through a
 * fixed worker pool. Progress is throttled to ~8 updates/sec so 100k-link
 * runs don't re-render React per link.
 */
export async function validateLinks(
  links: string[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<{ valid: string[]; broken: string[] }> {
  const workers = Math.max(1, Math.min(Math.floor(concurrency), MAX_VALIDATE_WORKERS));
  const ok = new Array<boolean>(links.length).fill(false);
  const settled = new Array<boolean>(links.length).fill(false);
  const status = new Array<number>(links.length).fill(0);
  let inFlight = 0;
  let done = 0;
  let lastReport = 0;
  // Semaphore: waiters register, every release wakes ALL waiters to re-check.
  // Wake-all (vs wake-one) guarantees no lost wakeups and no hangs on abort.
  let waiters: (() => void)[] = [];
  const waitForSlot = () => new Promise<void>((res) => waiters.push(res));
  const releaseSlot = () => {
    const wake = waiters;
    waiters = [];
    wake.forEach((w) => w());
  };

  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastReport >= 120) {
      lastReport = now;
      onProgress?.(done, links.length);
    }
  };

  /** Ambiguous failures — rate limits, timeouts, server hiccups — get one
   * retry so CDN throttling (e.g. Githack 403s under load) doesn't mark
   * working links broken. Definitive 404s are never retried. */
  const ambiguous = (status: number) => status === 0 || status === 403 || status === 429 || status >= 500;

  await Promise.all(
    links.map(async (url, i) => {
      // CPU-side pre-flight: reject malformed URLs with zero network cost.
      if (!isPlausibleUrl(url)) {
        settled[i] = true;
        done++;
        report();
        return;
      }
      // Acquire a network slot, then run the fetch. In-flight requests stay
      // pinned at `workers` (network saturation) while every other link's
      // bookkeeping runs in parallel on the main thread's event loop.
      while (inFlight >= workers) {
        if (shouldAbort?.()) return;
        await waitForSlot();
      }
      if (shouldAbort?.()) return;
      inFlight++;
      try {
        const st = await checkLink(url);
        status[i] = st;
        ok[i] = st >= 200 && st < 400;
      } finally {
        inFlight--;
        releaseSlot();
      }
      settled[i] = true;
      done++;
      report();
    }),
  );

  // Retry pass — only ambiguous failures, brief pause first, same slots.
  const retryIdx: number[] = [];
  settled.forEach((reached, i) => {
    if (reached && !ok[i] && isPlausibleUrl(links[i]) && ambiguous(status[i])) {
      retryIdx.push(i);
    }
  });
  if (retryIdx.length > 0 && !shouldAbort?.()) {
    await new Promise((r) => setTimeout(r, 1500));
    await Promise.all(
      retryIdx.map(async (i) => {
        while (inFlight >= workers) {
          if (shouldAbort?.()) return;
          await waitForSlot();
        }
        if (shouldAbort?.()) return;
        inFlight++;
        try {
          const st = await checkLink(links[i]);
          status[i] = st;
          if (st >= 200 && st < 400) ok[i] = true;
        } finally {
          inFlight--;
          releaseSlot();
        }
      }),
    );
  }
  report(true);

  const valid: string[] = [];
  const broken: string[] = [];
  settled.forEach((reached, i) => {
    if (!reached) return; // never reached (aborted) — don't count as broken
    (ok[i] ? valid : broken).push(links[i]);
  });
  return { valid, broken };
}

// ---------------------------------------------------------------------------
// jsDelivr Data API (for npm package mode)
// ---------------------------------------------------------------------------

export interface PackageVersion {
  version: string;
  svgCount: number;
  files: string[];
}

/** List the latest npm versions of a package and count SVGs in each. */
export async function listPackageVersions(pkg: string): Promise<PackageVersion[]> {
  const resp = await fetch(`${JSDELIVR_DATA}/package/npm/${encodeURIComponent(pkg)}`);
  if (resp.status === 404) {
    throw new GitHubError(`npm package not found: ${pkg}`, 404);
  }
  if (!resp.ok) {
    throw new GitHubError(`jsDelivr package lookup failed (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as { versions?: string[] };
  const versions = (data.versions ?? []).slice(0, 25).reverse(); // newest first, cap 25

  return versions.map((version) => ({ version, svgCount: 0, files: [] as string[] }));
}

/** Fetch the file list of one package version and keep only .svg paths. */
export async function getPackageSVGs(pkg: string, version: string): Promise<string[]> {
  const resp = await fetch(
    `${JSDELIVR_DATA}/package/npm/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}/flat`,
  );
  if (!resp.ok) {
    throw new GitHubError(`Could not list files for ${pkg}@${version} (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as { files?: { name: string }[] };
  return (data.files ?? [])
    .map((f) => f.name.replace(/^\//, ""))
    .filter((name) => name.toLowerCase().endsWith(".svg"));
}
