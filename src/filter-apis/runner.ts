// Batch runner for the Filters Checker.
//
// NOT just domain-level: filters like FortiGuard, Blocksi, Sophos, Linewize and
// Senso categorize full URLs, so "cdn.jsdelivr.net" can be unblocked while
// "cdn.jsdelivr.net/gh/user/repo" is blocked (or the reverse). Each generated
// serving URL is therefore probed at its exact host+path. Engines that can
// only see hostnames (DNS resolvers, Barracuda, Deledao, Lightspeed host
// lookup) are still queried per unique host and their verdict is merged into
// every target on that host, so a host-level block still flags the links.
//
// Caching: one entry per probed target. Host-only entries are cached per host
// and shared across all paths on that host; path-aware entries are cached per
// distinct host+path.

import type { DomainFilterResult, FilterDef, FilterResult } from "./types";
import { FILTERS } from "./registry";

/** All engines that receive the full URL (host + path). The rest only get the
 * bare host — see registry.ts `run` implementations for what each endpoint
 * actually accepts (Lightspeed, Deledao and Barracuda are host-keyed; the DNS
 * resolvers can only resolve hostnames). */
const PATH_AWARE = new Set(["FortiGuard", "Blocksi Web", "Blocksi AI", "Linewize", "Senso Cloud", "Sophos"]);

/** Strip the scheme, keep host + path + query — the canonical probe key. */
function targetKeyOf(url: string): string {
  const schemeEnd = url.indexOf("://");
  const rest = schemeEnd === -1 ? url : url.slice(schemeEnd + 3);
  // Drop trailing slash noise: "host/" and "host" are the same page.
  return rest.length > 1 && rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

const cache = new Map<string, DomainFilterResult>();

export function clearFilterCache(): void {
  cache.clear();
}

/** Filter name → FilterDef, for splitting engines by scope. */
function defs(): { pathAware: FilterDef[]; hostOnly: FilterDef[] } {
  const pathAware = FILTERS.filter((f) => PATH_AWARE.has(f.name));
  const hostOnly = FILTERS.filter((f) => !PATH_AWARE.has(f.name));
  return { pathAware, hostOnly };
}

function summarize(target: string, results: FilterResult[]): DomainFilterResult {
  const decisive = results.filter((r) => !r.error);
  return {
    domain: target,
    results,
    // "Blocked" = at least ONE responding filter flags this target. Requiring
    // every engine to agree would let a single clear DNS resolver hide a
    // FortiGuard/Sophos path-level block — precisely the false "all clear"
    // this checker used to report. Per-filter verdicts stay available for
    // the per-filter unblocked exports.
    blocked: decisive.some((r) => r.blocked),
  };
}

/** Run exactly the given subset of engines against one URL. */
async function runSubset(defsToRun: FilterDef[], url: string): Promise<FilterResult[]> {
  return Promise.all(
    defsToRun.map(async (f): Promise<FilterResult> => {
      try {
        const r = await f.run(url);
        const blocked = typeof r === "object" && r !== null ? !!(r as { blocked?: boolean }).blocked : !!r;
        return { name: f.name, blocked };
      } catch (e) {
        return { name: f.name, blocked: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/** Max distinct host+path probes kept per host. A 10k-file × 70-commit repo
 * has up to 700k unique serving URLs — probing every one would take days and
 * the result payload would be gigabytes. 200 sampled paths per host keeps
 * verdicts representative (reservoir-sampled, unbiased) while host-level
 * engines still cover EVERY URL on the host. */
const MAX_PATH_PROBES_PER_HOST = 200;

/**
 * Check serving URLs with bounded concurrency.
 *
 * Accepts a lazy Iterable so a multi-hundred-thousand-URL dataset never needs
 * to exist as one array. For each distinct host, host-only engines run once on
 * the bare host; their verdicts are merged into every target on that host.
 * Path-aware engines run per distinct host+path, reservoir-sampled to
 * MAX_PATH_PROBES_PER_HOST per host when a run exceeds that.
 */
export async function checkDomains(
  urls: Iterable<string>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<{ results: DomainFilterResult[]; sampled: boolean }> {
  const { pathAware, hostOnly } = defs();
  let sampledAny = false;

  // ── Plan the work: unique hosts + per-host sampled path targets ───────────
  const hostTargets = new Map<string, string>(); // host → probe key
  const reservoirs = new Map<string, { pool: string[]; seen: number }>(); // host → sampled path keys
  for (const url of urls) {
    const key = targetKeyOf(url);
    if (!key) continue;
    const host = key.split("/")[0].toLowerCase();
    if (!host) continue;
    if (!hostTargets.has(host)) hostTargets.set(host, host);
    if (key.length > host.length) {
      // Reservoir sampling: unbiased k-per-host sample in one streaming pass.
      let r = reservoirs.get(host);
      if (!r) reservoirs.set(host, (r = { pool: [], seen: 0 }));
      if (r.pool.length < MAX_PATH_PROBES_PER_HOST) {
        r.pool.push(key);
      } else {
        sampledAny = true;
        r.seen++;
        const slot = Math.floor(Math.random() * r.seen);
        if (slot < MAX_PATH_PROBES_PER_HOST) r.pool[slot] = key;
        continue;
      }
      r.seen++;
    }
  }
  const pathTargets = new Map<string, string>(); // host+path → probe key
  for (const { pool } of reservoirs.values()) {
    for (const key of pool) if (!pathTargets.has(key)) pathTargets.set(key, key);
  }

  // ── Determine what still needs network work (cache hits are free) ─────────
  const hostPending = [...hostTargets.values()].filter((t) => !cache.has(t));
  const pathPending = [...pathTargets.values()].filter((t) => !cache.has(t));

  const total = hostPending.length + pathPending.length;
  let nextIndex = 0;
  let done = 0;
  let lastReport = 0;

  const report = (force = false) => {
    const now = Date.now();
    if (force || now - lastReport >= 120) {
      lastReport = now;
      onProgress?.(done, total);
    }
  };

  // One shared worker pool drains host probes first, then path probes. The
  // Lightspeed WebSocket is one shared connection inside its engine, so a
  // bounded pool (2–24) keeps the socket from drowning either way.
  async function worker() {
    while (nextIndex < total) {
      if (shouldAbort?.()) return;
      const idx = nextIndex++;
      const target = idx < hostPending.length ? hostPending[idx] : pathPending[idx - hostPending.length];
      const isHostProbe = idx < hostPending.length;
      const results = await runSubset(isHostProbe ? hostOnly : pathAware, isHostProbe ? `https://${target}/` : `https://${target}`);
      cache.set(target, summarize(target, results));
      done++;
      report();
    }
  }

  const workers = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workers }, worker));
  report(true);

  // ── Assemble one result per target, merging host-only verdicts in ─────────
  const out: DomainFilterResult[] = [];
  for (const [host, hostKey] of hostTargets) {
    const hostEntry = cache.get(hostKey);
    for (const [key, pathKey] of pathTargets) {
      if (key.split("/")[0].toLowerCase() !== host) continue;
      const pathEntry = cache.get(pathKey);
      if (!pathEntry) continue; // aborted mid-run
      out.push(merge(hostEntry, pathEntry));
    }
    // Host with no generated path (e.g. a root link) — report it alone.
    if (![...pathTargets.keys()].some((k) => k.split("/")[0].toLowerCase() === host)) {
      if (hostEntry) out.push(hostEntry);
    }
  }
  return { results: out, sampled: sampledAny };
}

/** Combine a host-only verdict set with a path-aware verdict set. */
function merge(host: DomainFilterResult | undefined, path: DomainFilterResult): DomainFilterResult {
  const hostResults = (host?.results ?? []).filter((r) => !PATH_AWARE.has(r.name));
  const pathResults = path.results.filter((r) => PATH_AWARE.has(r.name));
  const results = [...hostResults, ...pathResults];
  const decisive = results.filter((r) => !r.error);
  return {
    domain: path.domain,
    results,
    blocked: decisive.some((r) => r.blocked),
  };
}

/** True when no filter blocks this URL's probed target (unknown → safe). */
export function isUrlSafe(url: string, results: DomainFilterResult[]): boolean {
  const key = targetKeyOf(url);
  const hit = results.find((r) => r.domain === key);
  return !hit || !hit.blocked;
}
