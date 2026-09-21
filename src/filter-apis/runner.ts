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
import { getSharedLightspeed } from "./lightspeed";

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

/** Max distinct host+path probes kept per host. Must stay in sync with the
 * plan's FILTER_PROBES_PER_HOST (linkset.ts). 40 sampled paths per host is
 * plenty — host-level engines still cover EVERY URL on the host — and it
 * keeps the whole filter run under a minute even on huge datasets. */
const MAX_PATH_PROBES_PER_HOST = 40;

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
      const next = summarize(target, results);
      const prev = cache.get(target);
      // Never let a transient ENGINE ERROR overwrite a known verdict on a bare
      // host entry: the host probe is the canonical Lightspeed answer for the
      // whole host (its protocol is host-keyed), and a raced path probe that
      // hits the same key must not clobber it with a timeout. Errors stay
      // visible on path entries (they can carry path-specific verdicts); the
      // honesty pass heals those after the pool drains.
      const errored = next.results.some((r) => r.error);
      cache.set(target, isHostProbe && prev && !prev.blocked && errored ? prev : next);
      done++;
      report();
    }
  }

  const workers = Math.max(1, Math.min(Math.max(concurrency, 2), 48, total));
  await Promise.all(Array.from({ length: workers }, worker));
  report(true);

  // ── Lightspeed honesty pass ─────────────────────────────────────────────
  // Lightspeed is host-keyed: whatever the first probe of a host got is the
  // verdict for every URL on it. If that first probe raced the WebSocket
  // handshake (a hard timeout on a cold connect), the whole host would be
  // branded "unblocked" forever — or its paths would sit at a stale error
  // even after the host answered. Re-run Lightspeed once for EVERY cached
  // entry whose LS verdict errored — by now the socket is open, the client's
  // own per-host cache dedupes retries, and a host that genuinely can't
  // answer keeps its visible per-filter error instead of an inflated
  // "unblocked" count.
  if (total > 0 && !shouldAbort?.()) {
    const lsDef = FILTERS.find((f) => f.name === "Lightspeed");
    // Retry only while a socket is actually OPEN — a socket that died (drop/
    // error) makes every retry a guaranteed-timeout no-op, and healing a
    // blocked network would just burn another full timeout per round. A
    // host that still can't answer keeps its visible per-filter error —
    // never a fabricated "unblocked" (fail closed).
    if (lsDef && getSharedLightspeed().isConnected()) {
      const stale: { key: string; probe: string }[] = [];
      for (const t of hostPending)
        if (cache.get(t)?.results.some((r) => r.name === "Lightspeed" && r.error))
          stale.push({ key: t, probe: `https://${t}/` });
      for (const t of pathPending)
        if (cache.get(t)?.results.some((r) => r.name === "Lightspeed" && r.error))
          stale.push({ key: t, probe: `https://${t}` });
      // Insurance against pathological silent-server cases: the heal exists
      // for the rare cold-socket race, so cap it — anything beyond this keeps
      // its honest per-filter error instead of re-paying timeouts.
      const staleCapped = stale.slice(0, 100);
      if (staleCapped.length > 0) {
        let done2 = 0;
        const total2 = staleCapped.length;
        const report2 = () => {
          done2++;
          onProgress?.(total + done2, total + total2);
        };
        let idx2 = 0;
        const refresh = async () => {
          while (idx2 < total2) {
            if (shouldAbort?.()) return;
            const { key, probe } = staleCapped[idx2++];
            try {
              const v = await lsDef.run(probe);
              const blocked = typeof v === "object" && v !== null ? !!(v as { blocked?: boolean }).blocked : !!v;
              const entry = cache.get(key);
              if (entry) {
                entry.results = entry.results.map((r) =>
                  r.name === "Lightspeed" ? { name: "Lightspeed", blocked } : r,
                );
                entry.blocked = entry.results.some((r) => !r.error && r.blocked);
              }
            } catch {
              // Still no answer — leave the per-filter error in place (fail
              // closed: unknown is reported, never "unblocked").
            }
            report2();
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, staleCapped.length) }, refresh));
      }
    }
  }

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
  const blockedHost = decisivelyBlocked(host);
  const blockedPath = decisivelyBlocked(path);
  return {
    domain: path.domain,
    results,
    // "Blocked" = at least ONE responding filter flags this target. A filter
    // that ERRORed can't know (fail closed: errors never read as "unblocked"),
    // and requiring every engine to agree would let a single clear DNS
    // resolver hide a FortiGuard/Sophos path-level block — precisely the
    // false "all clear" this checker used to report.
    blocked: blockedHost || blockedPath,
  };
}

/** True when at least one filter with an actual verdict flags the target. */
function decisivelyBlocked(entry: DomainFilterResult | undefined): boolean {
  if (!entry) return false;
  return entry.results.some((r) => !r.error && r.blocked);
}

/** True when no filter blocks this URL's probed target (unknown → safe). */
export function isUrlSafe(url: string, results: DomainFilterResult[]): boolean {
  const key = targetKeyOf(url);
  const hit = results.find((r) => r.domain === key);
  return !hit || !hit.blocked;
}
