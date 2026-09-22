// Compact implicit link dataset — the fast-generation core.
//
// A generated URL is never random: it is always
//     prefix(provider, source, ref) + encodedPath
// so instead of materializing tens of millions of URL strings (which is what
// made low-end devices die), we keep
//   - one tiny prefix template per (provider × source × ref),
//   - each source's file lists ONCE per distinct file-set (commits that share
//     a tree share one group),
//   - and derive every URL lazily by string concat only when it is actually
//     needed (export line, table row, probe candidate).
//
// Memory for 10k files × 70 commits × 20 providers (14M URLs) drops from
// ~2 GB of URL strings to a few MB of paths + SHAs, and generation becomes
// pure integer bookkeeping on top of the tree fetches.

import { CDNProvider } from "./cdns";
import { PATH_AWARE_FILTERS } from "../filter-apis/registry";

/** "ref" URLs embed the commit/version before the path; "pages" URLs do not
 * (owner.github.io/repo/path is ref-independent — the URL string repeats per
 * ref, exactly like the legacy per-link generation did). */
export type SlotVariant = "ref" | "pages";

export interface LinkSlot {
  provider: CDNProvider;
  variant: SlotVariant;
}

/** One distinct file-set within a source, with the refs that contain it. */
export interface LinkGroup {
  /** Raw (unencoded) file paths, sorted — the canonical key is their join. */
  paths: string[];
  /** Indices into the owning source's `refs` array. */
  refIdx: number[];
}

export interface LinkSource {
  /** "owner/repo" (repo mode) or "pkg@version" (npm mode). */
  key: string;
  /** Repo owner — or the npm package name in npm mode. */
  owner: string;
  /** Repo name ("" in npm mode). */
  name: string;
  /** Commit SHAs (repo mode, newest first) or the single version (npm mode). */
  refs: string[];
  groups: LinkGroup[];
}

export interface LinkSet {
  mode: "repo" | "npm";
  slots: LinkSlot[];
  sources: LinkSource[];
  bunnyZone?: string;
  totalUrls: number;
  /** Distinct file paths across every source. */
  uniquePaths: number;
}

/** Encode every path segment so spaces, #, ? and unicode can't break the URL.
 * Mirrors cdns.ts encodePath exactly. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * Everything before the variable path tail, ending with "/". Mirrors
 * generateCDNLink's per-format output byte-for-byte (verified by tests).
 */
export function slotPrefix(slot: LinkSlot, src: LinkSource, ref: string, bunnyZone?: string): string {
  const p = slot.provider;
  switch (p.format) {
    case "static": // StaticDelivr — no @ (the @ shape 404s there)
      return `https://${p.domain}/gh/${src.owner}/${src.name}/${ref}/`;
    case "statically":
      return `https://${p.domain}/gh/${src.owner}/${src.name}@${ref}/`;
    case "raw":
      return `https://${p.domain}/${src.owner}/${src.name}/${ref}/`;
    case "ghraw":
      return `https://raw.githubusercontent.com/${src.owner}/${src.name}/${ref}/`;
    case "esm":
      return `https://${p.domain}/gh/${src.owner}/${src.name}@${ref}/`;
    case "proxy":
      return `https://${p.domain}/https://raw.githubusercontent.com/${src.owner}/${src.name}/${ref}/`;
    case "npm":
      return `https://${p.domain}/npm/${src.owner}@${ref}/`;
    case "npmunpkg":
      return `https://${p.domain}/${src.owner}@${ref}/`;
    case "pages":
      return `https://${src.owner}.github.io/${src.name}/`;
    case "bunny": {
      const zone = (bunnyZone || "").replace(/[^a-z0-9-]/g, "");
      if (!zone) return ""; // no zone configured — slots like this are never created
      return `https://${zone}.b-cdn.net/https://raw.githubusercontent.com/${src.owner}/${src.name}/${ref}/`;
    }
    case "gh": // jsDelivr style
      return `https://${p.domain}/gh/${src.owner}/${src.name}@${ref}/`;
  }
}

export interface UrlEntry {
  url: string;
  source: string;
  path: string;
  ref: string;
  provider: CDNProvider;
}

/**
 * Iterate every URL with row metadata, lazily. `skip`/`take` window the FLAT
 * sequence (matching the legacy links[] order semantics) — skipped URLs are
 * never materialized, so table paging stays O(page) at any dataset size.
 */
export function* iterUrlEntries(
  set: LinkSet,
  window?: { skip?: number; take?: number },
): Generator<UrlEntry> {
  const skip = window?.skip ?? 0;
  const take = window?.take ?? Infinity;
  let seen = 0;
  let yielded = 0;
  for (const src of set.sources) {
    const encMemo = new Map<string, string>();
    const staticPrefix = set.slots.map((s) =>
      s.variant === "pages" ? slotPrefix(s, src, "", set.bunnyZone) : "",
    );
    for (const g of src.groups) {
      for (const ri of g.refIdx) {
        const ref = src.refs[ri];
        const prefixes = set.slots.map((s, i) =>
          s.variant === "pages" ? staticPrefix[i] : slotPrefix(s, src, ref, set.bunnyZone),
        );
        for (const raw of g.paths) {
          let enc = encMemo.get(raw);
          if (enc === undefined) {
            enc = encodePath(raw);
            encMemo.set(raw, enc);
          }
          for (let i = 0; i < set.slots.length; i++) {
            if (seen++ < skip) continue;
            if (yielded >= take) return;
            const url = prefixes[i] + enc;
            if (!prefixes[i]) continue;
            yielded++;
            yield { url, source: src.key, path: raw, ref, provider: set.slots[i].provider };
          }
        }
      }
    }
  }
}

/** Plain URL iterator — zero allocations beyond the string itself. */
export function* iterUrls(set: LinkSet): Generator<string> {
  for (const e of iterUrlEntries(set)) yield e.url;
}

export interface JsonLinkOut {
  source: string;
  path: string;
  ref: string;
  urls: { provider: string; domain: string; url: string }[];
}

/** Grouped iterator for the JSON export — one object per (ref, path) with all
 * its provider URLs, mirroring the legacy linksToJSON shape. */
export function* iterLinks(set: LinkSet): Generator<JsonLinkOut> {
  for (const src of set.sources) {
    const encMemo = new Map<string, string>();
    const staticPrefix = set.slots.map((s) =>
      s.variant === "pages" ? slotPrefix(s, src, "", set.bunnyZone) : "",
    );
    for (const g of src.groups) {
      for (const ri of g.refIdx) {
        const ref = src.refs[ri];
        const prefixes = set.slots.map((s, i) =>
          s.variant === "pages" ? staticPrefix[i] : slotPrefix(s, src, ref, set.bunnyZone),
        );
        for (const raw of g.paths) {
          let enc = encMemo.get(raw);
          if (enc === undefined) {
            enc = encodePath(raw);
            encMemo.set(raw, enc);
          }
          const urls: { provider: string; domain: string; url: string }[] = [];
          for (let i = 0; i < set.slots.length; i++) {
            if (!prefixes[i]) continue;
            urls.push({
              provider: set.slots[i].provider.name,
              domain: set.slots[i].provider.domain,
              url: prefixes[i] + enc,
            });
          }
          if (urls.length > 0) yield { source: src.key, path: raw, ref, urls };
        }
      }
    }
  }
}

/** Distinct file-set count helper used by the plan: refs containing each path. */
const refCountCache = new WeakMap<LinkSource, Map<string, number>>();
export function pathRefCounts(src: LinkSource): Map<string, number> {
  let m = refCountCache.get(src);
  if (!m) {
    m = new Map<string, number>();
    for (const g of src.groups) {
      for (const p of g.paths) m.set(p, (m.get(p) ?? 0) + g.refIdx.length);
    }
    refCountCache.set(src, m);
  }
  return m;
}

// Filter-check planning — the fast path that never walks the full dataset.
// ---------------------------------------------------------------------------

/** Probe-budget ceiling per serving host. Realistic 15–25 CDN/filter hosts →
 * 200–600 probes total. Each probe is answered by ~14 filter engines, so
 * this stays a few thousand requests regardless of dataset size — and the
 * per-host breaker (runner) ensures a dead engine costs seconds, not minutes. */
export const FILTER_PROBES_PER_HOST = 200;

/** The host that ACTUALLY serves this slot's URLs for a source. Pages URLs
 * live on owner.github.io (not a provider domain) and bunny on the user's
 * zone — filtering verdicts must be grouped by the real host, or a host-level
 * block on one provider gets misattributed to every other. */
function servingHost(slot: LinkSlot, src: LinkSource, bunnyZone?: string): string {
  if (slot.variant === "pages") return `${src.owner}.github.io`;
  if (slot.provider.format === "bunny") {
    const zone = (bunnyZone || "").replace(/[^a-z0-9-]/g, "");
    return zone ? `${zone}.b-cdn.net` : "";
  }
  return slot.provider.domain;
}

export interface FilterPlan {
  /** Candidate probe URLs (≤ maxPerHost per serving host + newest-state
   * coverage). The runner probes exactly these + one bare-host probe per
   * unique host. */
  urls: string[];
  /** Probe key (URL minus scheme) → how many dataset URLs share that key.
   * 1 for ref-variant URLs; ref-count for pages URLs. */
  multByKey: Map<string, number>;
  /** Serving host → total dataset URLs behind it. */
  hostTotals: Map<string, number>;
  /** Serving host → candidate count taken for it (≤ maxPerHost). */
  hostProbed: Map<string, number>;
  /** Serving host → DISTINCT (host, path) URLs in the dataset behind it.
   * The honest denominator for per-host path coverage. */
  hostDistinctPaths: Map<string, number>;
  /** True when the dataset has more distinct URLs than were probed. */
  sampled: boolean;
}

/**
 * Build the filter-check probe plan WITHOUT iterating the dataset.
 *
 * Probes are normalized to (host, path) — the actual key path-aware filter
 * databases answer on. The URL space is prefix(host, provider, src, ref) +
 * encodedPath, so two dataset URLs sharing a path differ only by ref/prefix
 * — and a filter CANNOT see a commit SHA. The old plan sampled (ref, path)
 * pairs, so with many commits it wasted its budget probing the same path at
 * different SHAs (every probe answered identically). This plan probes each
 * DISTINCT path once per serving host — the maximum obtainable accuracy per
 * request — weighting Pages probes by their ref-count multiplicity.
 *
 * The per-host budget adapts to the run: hosts = max(4, ceil(3000/hosts))
 * capped at 200 — a handful of hosts probes ~200 paths each, a 25-provider
 * run ~120 each. Total probes stay ≈ a few thousand at ANY dataset size.
 */
export function buildFilterPlan(set: LinkSet, maxPerHostArg?: number): FilterPlan {
  // Adaptive budget: total probe ceiling ≈ 3000 spread over the serving hosts.
  const hostSet = new Set<string>();
  for (const src of set.sources)
    for (const s of set.slots) {
      const h = servingHost(s, src, set.bunnyZone);
      if (h) hostSet.add(h);
    }
  const maxPerHost = maxPerHostArg ??
    Math.min(FILTER_PROBES_PER_HOST, Math.max(40, Math.ceil(3000 / Math.max(hostSet.size, 1))));

  const urls: string[] = [];
  const multByKey = new Map<string, number>();
  const hostTotals = new Map<string, number>();
  const hostProbed = new Map<string, number>();
  const hostDistinctPaths = new Map<string, number>();
  let sampled = false;

  // One push per DISTINCT probe key: (prefix-host + path) is what path-aware
  // filter databases actually answer on, mult = the number of dataset URLs
  // sharing that exact key (1 for ref-variant URLs; ref-count for pages).
  // Returns false for duplicates so the caller's walk can continue cheaply.
  const takeKey = (url: string, mult: number, host: string): boolean => {
    const key = url.slice(8); // strip "https://" — matches the runner's probe key
    if (multByKey.has(key)) return false;
    multByKey.set(key, mult);
    hostProbed.set(host, (hostProbed.get(host) ?? 0) + 1);
    urls.push(url);
    return true;
  };

  const countsMemo = new WeakMap<LinkSource, Map<string, number>>();
  const refCountsOf = (src: LinkSource): Map<string, number> => {
    let m = countsMemo.get(src);
    if (!m) {
      m = pathRefCounts(src);
      countsMemo.set(src, m);
    }
    return m;
  };
  const distinctPathsMemo = new WeakMap<LinkSource, number>();
  const distinctPathsOf = (src: LinkSource): number => {
    let n = distinctPathsMemo.get(src);
    if (n === undefined) {
      const seen = new Set<string>();
      for (const g of src.groups) for (const p of g.paths) seen.add(p);
      n = seen.size;
      distinctPathsMemo.set(src, n);
    }
    return n;
  };

  // Pass 1 — per-(source, slot) stats. Each (src, slot) becomes one
  // "contributor" for its serving host; contributors sharing a host SHARE
  // that host's probe budget. Probes use the newest ref's prefix: the SHA is
  // invisible to filter categorization, so one probe per distinct path is
  // the maximum obtainable accuracy per request.
  interface Contributor {
    host: string;
    prefix: string;
    /** Pages URLs repeat per ref — weight each probe by its ref count. */
    pages: boolean;
    groups: LinkGroup[];
    counts: Map<string, number> | null;
    gi: number;
    pi: number;
    done: boolean;
  }
  const contributors: Contributor[] = [];

  for (const src of set.sources) {
    for (const s of set.slots) {
      const host = servingHost(s, src, set.bunnyZone);
      if (!host) continue;

      let total = 0;
      for (const g of src.groups) total += g.refIdx.length * g.paths.length;
      if (total === 0) continue;
      hostTotals.set(host, (hostTotals.get(host) ?? 0) + total);

      // Distinct probe keys this (src, slot) contributes to the host — the
      // honest denominator for path-level coverage (prefixes differ per
      // source, so keys can't collide across sources).
      hostDistinctPaths.set(host, (hostDistinctPaths.get(host) ?? 0) + distinctPathsOf(src));

      contributors.push({
        host,
        prefix: slotPrefix(s, src, s.variant === "pages" ? "" : src.refs[0], set.bunnyZone),
        pages: s.variant === "pages",
        groups: src.groups,
        counts: s.variant === "pages" ? refCountsOf(src) : null,
        gi: 0,
        pi: 0,
        done: false,
      });
    }
  }
  for (const d of hostDistinctPaths.values()) if (d > maxPerHost) sampled = true;

  // Pass 2 — round-robin: on each turn the next contributor takes its next
  // distinct path, until every host's budget is spent or every contributor
  // is exhausted. This spreads each host's budget across ALL of its sources,
  // so a multi-repo run gets path coverage for EVERY repo instead of the
  // first repo hogging the whole quota. No intermediate arrays (the old
  // flatMap materialized every path list per slot); paths shared across
  // file-sets dedupe for free via takeKey and cost nothing.
  let remaining = contributors.length;
  while (remaining > 0) {
    for (const c of contributors) {
      if (c.done) continue;
      if ((hostProbed.get(c.host) ?? 0) >= maxPerHost) {
        c.done = true;
        remaining--;
        continue;
      }
      let took = false;
      while (c.gi < c.groups.length) {
        const g = c.groups[c.gi];
        if (c.pi >= g.paths.length) {
          c.gi++;
          c.pi = 0;
          continue;
        }
        const raw = g.paths[c.pi++];
        if (takeKey(c.prefix + encodePath(raw), c.pages ? c.counts!.get(raw) ?? 1 : 1, c.host)) {
          took = true;
          break;
        }
      }
      if (!took) {
        c.done = true;
        remaining--;
      }
    }
  }

  return {
    urls,
    multByKey,
    hostTotals,
    hostProbed,
    hostDistinctPaths,
    sampled,
  };
}

export interface FilterVerdictEntry {
  name: string;
  blocked: boolean;
  error?: string;
}

/** Minimal shape of a runner result the counter needs. */
export interface FilterVerdictLookup {
  get(key: string):
    | { domain: string; blocked: boolean; results: FilterVerdictEntry[] }
    | undefined;
}

export interface FilterCountResult {
  /** Per-filter blocked URL counts (arithmetically weighted). */
  perFilterBlocked: Record<string, number>;
  /** Per-filter ERROR/unverified counts — URLs whose verdict for that filter
   * is UNKNOWN (timeout, endpoint down, socket blocked) or never probed at
   * path level (path-aware engines, unsampled distinct path). A filter must
   * never quietly fold these into "unblocked". */
  perFilterErrors: Record<string, number>;
  /** Per-filter VERIFIED URLs — verdict produced (blocked or clear).
   * verified + errors = totalUrls, exactly, per filter. */
  perFilterVerified: Record<string, number>;
  /** Small per-host coverage summary for the UI. */
  hostCoverage: { host: string; urls: number; distinctPaths: number; probed: number }[];
  /** URLs flagged by the aggregate "any filter" verdict. */
  blockedAgg: number;
  /** Probe keys whose aggregate verdict is blocked (the small set). */
  blockedKeys: Set<string>;
  /** Hosts whose bare-host probe is BLOCKED by a host-keyed engine — every
   * URL on these hosts is blocked regardless of path sampling (host-keyed
   * verdicts cover the whole host, probed paths or not). */
  blockedHosts: Set<string>;
  /** filterSafeCount = totalUrls − blockedAgg. */
  safeCount: number;
}

/**
 * Arithmetic per-filter counting from the probe plan. Each probe key k stands
 * for mult(k) dataset URLs.
 *
 * Verdict inheritance — exactly per engine class (PATH_AWARE_FILTERS):
 *  • Path-aware engines (FortiGuard, Blocksi ×2, Linewize, Senso, Sophos) are
 *    probed per distinct path: a probed path carries its own verdict; an
 *    UNSAMPLED distinct path has NO path-level verdict there — the honest
 *    accounting is UNVERIFIED, never a borrowed "unblocked". (The old model
 *    let unsampled paths inherit the root-path verdict — a verdict for "/"
 *    says nothing about "/gh/u/r@sha/x.svg".)
 *  • Host-keyed engines (DNS resolvers, Lightspeed, Deledao, Barracuda) are
 *    probed once per host; their verdict applies to EVERY URL on the host.
 * O(plan × filters) — the dataset itself is never walked.
 */
export function countFilterVerdicts(
  set: LinkSet,
  plan: FilterPlan,
  byKey: FilterVerdictLookup,
  filterNames: string[],
): FilterCountResult {
  const perFilterBlocked: Record<string, number> = {};
  const perFilterErrors: Record<string, number> = {};
  const perFilterVerified: Record<string, number> = {};
  for (const name of filterNames) {
    perFilterBlocked[name] = 0;
    perFilterErrors[name] = 0;
    perFilterVerified[name] = 0;
  }
  let blockedAgg = 0;
  const blockedKeys = new Set<string>();
  const blockedHosts = new Set<string>();

  const hostOf = (key: string): string => key.slice(0, key.indexOf("/")) || key;
  const hosts = new Set<string>();
  for (const src of set.sources) {
    for (const s of set.slots) {
      const h = servingHost(s, src, set.bunnyZone);
      if (h) hosts.add(h);
    }
  }

  for (const host of hosts) {
    const total = plan.hostTotals.get(host) ?? 0;
    const hostEntry = byKey.get(host); // runner probes the bare host under this key
    const hostVerdict = new Map<string, FilterVerdictEntry>();
    if (hostEntry) for (const e of hostEntry.results) hostVerdict.set(e.name, e);

    let probedMult = 0;
    for (const [key, mult] of plan.multByKey) {
      if (hostOf(key) !== host) continue;
      probedMult += mult;
      const entry = byKey.get(key);
      if (!entry) {
        // Aborted mid-run — no verdicts at all for this key: count every
        // filter as unverified rather than silently shrinking its totals.
        for (const name of filterNames) perFilterErrors[name] += mult;
        continue;
      }
      if (entry.blocked) {
        blockedAgg += mult;
        blockedKeys.add(key);
      }
      const pathResults = new Map<string, FilterVerdictEntry>();
      for (const e of entry.results) pathResults.set(e.name, e);
      for (const name of filterNames) {
        const v = pathResults.get(name);
        if (!v || v.error) {
          perFilterErrors[name] += mult;
        } else {
          perFilterVerified[name] += mult;
          if (v.blocked) perFilterBlocked[name] += mult;
        }
      }
    }

    const unsampled = total - probedMult;
    if (unsampled > 0) {
      if (hostEntry?.blocked) {
        blockedAgg += unsampled;
        blockedHosts.add(host);
      }
      for (const name of filterNames) {
        if (PATH_AWARE_FILTERS.has(name)) {
          // No path-level observation exists for unsampled distinct paths —
          // unverified for path-aware engines (a host block still lands in
          // blockedAgg above; the per-filter verdict simply wasn't observed).
          perFilterErrors[name] += unsampled;
        } else {
          // Host-keyed engines decided every URL on this host already.
          const v = hostVerdict.get(name);
          if (!v || v.error) {
            perFilterErrors[name] += unsampled;
          } else {
            perFilterVerified[name] += unsampled;
            if (v.blocked) perFilterBlocked[name] += unsampled;
          }
        }
      }
    }
  }

  const hostCoverage = [...plan.hostTotals.entries()]
    .map(([host, urls]) => ({
      host,
      urls,
      distinctPaths: plan.hostDistinctPaths.get(host) ?? 0,
      probed: plan.hostProbed.get(host) ?? 0,
    }))
    .sort((a, b) => b.urls - a.urls);

  return {
    perFilterBlocked,
    perFilterErrors,
    perFilterVerified,
    hostCoverage,
    blockedAgg,
    blockedKeys,
    blockedHosts,
    safeCount: set.totalUrls - blockedAgg,
  };
}
