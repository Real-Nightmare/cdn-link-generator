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

// ---------------------------------------------------------------------------
// Filter-check planning — the fast path that never walks the full dataset.
// ---------------------------------------------------------------------------

/** Probing budget per serving host. Must stay in sync with the runner's
 * own per-host reservoir cap (the plan feeds at most this many). */
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
  /** Candidate probe URLs (≤ FILTER_PROBES_PER_HOST per serving host +
   * newest-state coverage). The runner probes exactly these + one bare-host
   * probe per unique host. */
  urls: string[];
  /** Probe key (URL minus scheme) → how many dataset URLs share that key.
   * 1 for ref-variant URLs; ref-count for pages URLs. */
  multByKey: Map<string, number>;
  /** Serving host → total dataset URLs behind it. */
  hostTotals: Map<string, number>;
  /** Serving host → candidate count taken for it (≤ maxPerHost). */
  hostProbed: Map<string, number>;
  /** True when the dataset has more distinct URLs than were probed. */
  sampled: boolean;
}

/**
 * Build the filter-check probe plan WITHOUT iterating the dataset: newest-ref
 * paths first (users care about live state), then a deterministic stride
 * sample across the (ref × path) space per serving host. Pages URLs collapse
 * by ref — their multiplicity comes from pathRefCounts. O(sources × slots ×
 * paths + plan) — at 45M links this builds a few hundred candidates.
 */
export function buildFilterPlan(set: LinkSet, maxPerHost = FILTER_PROBES_PER_HOST): FilterPlan {
  const urls: string[] = [];
  const multByKey = new Map<string, number>();
  const hostTotals = new Map<string, number>();
  const hostProbed = new Map<string, number>();
  let sampled = false;

  const takeKey = (url: string, mult: number, host: string): void => {
    const key = url.slice(8); // strip "https://" — matches the runner's probe key
    if (multByKey.has(key)) return;
    if ((hostProbed.get(host) ?? 0) >= maxPerHost) return;
    multByKey.set(key, mult);
    hostProbed.set(host, (hostProbed.get(host) ?? 0) + 1);
    urls.push(url);
  };

  for (const src of set.sources) {
    for (const s of set.slots) {
      const host = servingHost(s, src, set.bunnyZone);
      if (!host) continue;

      let total = 0;
      for (const g of src.groups) total += g.refIdx.length * g.paths.length;
      if (total === 0) continue;
      hostTotals.set(host, (hostTotals.get(host) ?? 0) + total);

      // Phase A — newest-state coverage: refs[0] is the newest commit (or the
      // npm version); spend half the quota across its groups' paths.
      const newestQuota = Math.floor(maxPerHost / 2);
      let newestTaken = 0;
      for (const g of src.groups) {
        if (!g.refIdx.includes(0)) continue;
        const ref = src.refs[0];
        const stride = Math.max(1, Math.ceil(g.paths.length / Math.max(1, newestQuota - newestTaken)));
        for (let pi = 0; pi < g.paths.length && newestTaken < newestQuota; pi += stride) {
          const raw = g.paths[pi];
          const enc = encodePath(raw);
          if (s.variant === "pages") {
            takeKey(slotPrefix(s, src, "", set.bunnyZone) + enc, pathRefCounts(src).get(raw) ?? 1, host);
          } else {
            takeKey(slotPrefix(s, src, ref, set.bunnyZone) + enc, 1, host);
          }
          newestTaken++;
        }
      }

      // Phase B — deterministic stride across the whole (ref × path) space.
      const space = s.variant === "pages"
        ? src.groups.reduce((a, g) => a + g.paths.length, 0)
        : src.groups.reduce((a, g) => a + g.refIdx.length * g.paths.length, 0);
      const remaining = maxPerHost - (hostProbed.get(host) ?? 0);
      if (space > 0 && remaining > 0) {
        const stride = Math.max(1, Math.ceil(space / remaining));
        let idx = 0;
        for (const g of src.groups) {
          if ((hostProbed.get(host) ?? 0) >= maxPerHost) break;
          if (s.variant === "pages") {
            const prefix = slotPrefix(s, src, "", set.bunnyZone);
            const counts = pathRefCounts(src);
            for (const raw of g.paths) {
              if (idx++ % stride === 0) {
                takeKey(prefix + encodePath(raw), counts.get(raw) ?? 1, host);
                if ((hostProbed.get(host) ?? 0) >= maxPerHost) break;
              }
            }
          } else {
            for (const ri of g.refIdx) {
              if ((hostProbed.get(host) ?? 0) >= maxPerHost) break;
              const ref = src.refs[ri];
              for (const raw of g.paths) {
                if (idx++ % stride === 0) {
                  takeKey(slotPrefix(s, src, ref, set.bunnyZone) + encodePath(raw), 1, host);
                  if ((hostProbed.get(host) ?? 0) >= maxPerHost) break;
                }
              }
            }
          }
        }
      }

      const distinct = s.variant === "pages"
        ? src.groups.reduce((a, g) => a + g.paths.length, 0)
        : total;
      if (distinct > candidatesFor(host)) sampled = true;
    }
  }

  function candidatesFor(host: string): number {
    return hostProbed.get(host) ?? 0;
  }

  return { urls, multByKey, hostTotals, hostProbed, sampled };
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
  /** URLs flagged by the aggregate "any filter" verdict. */
  blockedAgg: number;
  /** Probe keys whose aggregate verdict is blocked (the small set). */
  blockedKeys: Set<string>;
  /** filterSafeCount = totalUrls − blockedAgg. */
  safeCount: number;
}

/**
 * Arithmetic per-filter counting from the probe plan. Each probe key k stands
 * for mult(k) dataset URLs. Probed keys carry the merged (host + path)
 * verdicts; the unprobed remainder of a domain inherits its HOST probe's
 * verdicts (host-level engines decided it), while path-aware engines had no
 * verdict there — counted unblocked, matching the old host-fallback behavior.
 * O(plan × filters) — the 45M-link dataset itself is never walked.
 */
export function countFilterVerdicts(
  set: LinkSet,
  plan: FilterPlan,
  byKey: FilterVerdictLookup,
  filterNames: string[],
): FilterCountResult {
  const perFilterBlocked: Record<string, number> = {};
  for (const name of filterNames) perFilterBlocked[name] = 0;
  let blockedAgg = 0;
  const blockedKeys = new Set<string>();

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
    let probedMult = 0;
    const hostEntry = byKey.get(host); // runner probes the bare host under this key
    const hostVerdict = new Map<string, FilterVerdictEntry>();
    if (hostEntry) for (const e of hostEntry.results) hostVerdict.set(e.name, e);

    for (const [key, mult] of plan.multByKey) {
      if (hostOf(key) !== host) continue;
      probedMult += mult;
      const entry = byKey.get(key);
      if (!entry) continue; // aborted mid-run — remainder falls back below
      if (entry.blocked) {
        blockedAgg += mult;
        blockedKeys.add(key);
      }
      for (const name of filterNames) {
        const v = entry.results.find((e) => e.name === name);
        if (v && !v.error && v.blocked) perFilterBlocked[name] += mult;
      }
    }

    const unsampled = total - probedMult;
    if (unsampled > 0 && hostEntry) {
      if (hostEntry.blocked) blockedAgg += unsampled;
      for (const name of filterNames) {
        const v = hostVerdict.get(name);
        if (v && !v.error && v.blocked) perFilterBlocked[name] += unsampled;
      }
    }
  }

  return { perFilterBlocked, blockedAgg, blockedKeys, safeCount: set.totalUrls - blockedAgg };
}
