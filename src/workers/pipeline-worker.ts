// Pipeline worker — the off-main-thread backend for Link Studio.
//
// Owns the ENTIRE generated dataset for its lifetime as a compact implicit
// LinkSet (prefix templates + path groups — see lib/linkset.ts). URLs are
// materialized only when a consumer actually needs the string (a table page,
// an export line, a probe candidate), which is what lets a low-end device
// hold and export tens of millions of links.

import {
  buildZipLazy,
  generateLinks,
  generatePackageLinks,
  type GenProgress,
  type GenResult,
  type ZipLazyEntry,
} from "../lib/generate";
import { validateLinks } from "../lib/github";
import { checkDomains } from "../filter-apis/runner";
import { FILTERS as FILTER_DEFS, type DomainFilterResult } from "../filter-apis/registry";
import {
  buildCsvChunks,
  buildJsonChunks,
  buildTextChunks,
  type ExportRow,
  type JsonLink,
} from "../lib/export-builders";
import { uploadToGofile, shouldOffloadToGofile, chunkSize } from "../lib/gofile";
import {
  buildFilterPlan,
  countFilterVerdicts,
  iterLinks,
  iterUrlEntries,
  iterUrls,
  type FilterPlan,
} from "../lib/linkset";

interface FilterState {
  plan: FilterPlan | null;
  /** Probe results keyed by probe key (URL minus scheme). */
  byKey: Map<string, DomainFilterResult>;
  /** Probe keys flagged by the aggregate verdict — the SMALL set used for
   * scoped "safe" iteration and table statuses. */
  blockedKeys: Set<string>;
  filterSafeCount: number;
  filterSampled: boolean;
}

const state: {
  result: GenResult | null;
  totalUrls: number;
  uniqueSvgCount: number;
  validSet: Set<string>;
  brokenSet: Set<string>;
  filter: FilterState;
} = {
  result: null,
  totalUrls: 0,
  uniqueSvgCount: 0,
  validSet: new Set(),
  brokenSet: new Set(),
  filter: { plan: null, byKey: new Map(), blockedKeys: new Set(), filterSafeCount: 0, filterSampled: false },
};

let abortFlag = false;
const shouldAbort = (): boolean => abortFlag;

const post = (msg: unknown, transfer?: Transferable[]): void => {
  (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(
    msg,
    transfer,
  );
};

const postGenProgress = (p: GenProgress): void => post({ type: "progress", kind: "gen", payload: p });
const postValProgress = (done: number, total: number): void =>
  post({ type: "progress", kind: "validate", payload: { done, total } });
const postFilterProgress = (done: number, total: number): void =>
  post({ type: "progress", kind: "filters", payload: { done, total } });

function resetForNewRun(): void {
  abortFlag = false;
  state.result = null;
  state.totalUrls = 0;
  state.uniqueSvgCount = 0;
  state.validSet = new Set();
  state.brokenSet = new Set();
  state.filter = { plan: null, byKey: new Map(), blockedKeys: new Set(), filterSafeCount: 0, filterSampled: false };
}

/** Scheme-stripped probe key — matches the runner's targetKeyOf for our URLs
 * (all https, never a trailing slash). One slice, no URL parsing. */
function keyOf(url: string): string {
  return url.slice(8);
}

function inScope(url: string, scope: string): boolean {
  if (scope === "valid") return state.validSet.has(url);
  if (scope === "safe") return !state.filter.blockedKeys.has(keyOf(url));
  return true;
}

/** Lazy scoped URL iterator — never materializes the full array. */
function* scopedUrls(scope: string): Generator<string> {
  const set = state.result?.set;
  if (!set) return;
  for (const url of iterUrls(set)) {
    if (inScope(url, scope)) yield url;
  }
}

/** Lazy scoped export-row iterator (for CSV). */
function* scopedRows(scope: string): Generator<ExportRow> {
  const set = state.result?.set;
  if (!set) return;
  for (const e of iterUrlEntries(set)) {
    if (!inScope(e.url, scope)) continue;
    yield {
      source: e.source,
      path: e.path,
      commit: e.ref,
      provider: e.provider.name,
      domain: e.provider.domain,
      url: e.url,
    };
  }
}

/** Lazy scoped link iterator for the grouped JSON export — mirrors the
 * legacy linksToJSON shape (one object per SVG/ref with all its URLs). */
function* scopedJsonLinks(scope: string): Generator<JsonLink> {
  const set = state.result?.set;
  if (!set) return;
  for (const l of iterLinks(set)) {
    const urls = l.urls.filter((u) => inScope(u.url, scope));
    if (urls.length === 0) continue;
    yield { source: l.source, path: l.path, ref: l.ref, urls };
  }
}

async function runGenerate(msg: {
  gen: number;
  mode: "repo" | "npm";
  repos: { owner: string; name: string }[];
  npmPkg: string;
  versions: string[];
  commitsPerSVG: number;
  cdnSelection: string[];
  token: string;
  bunnyZone: string;
  urlBudget?: number;
}): Promise<void> {
  resetForNewRun();
  try {
    if (msg.mode === "repo") {
      state.result = await generateLinks(
        msg.repos,
        {
          commitsPerSVG: msg.commitsPerSVG,
          cdnSelection: msg.cdnSelection,
          urlBudget: msg.urlBudget,
        },
        msg.token || undefined,
        postGenProgress,
        shouldAbort,
        msg.bunnyZone || undefined,
      );
    } else {
      state.result = await generatePackageLinks(
        msg.npmPkg,
        msg.versions,
        { commitsPerSVG: msg.commitsPerSVG, cdnSelection: msg.cdnSelection },
        postGenProgress,
        shouldAbort,
      );
    }
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
    return;
  }
  state.totalUrls = state.result.set.totalUrls;
  state.uniqueSvgCount = state.result.set.uniquePaths;
  post({
    type: "done",
    gen: msg.gen,
    payload: {
      repos: state.result.repos,
      truncated: state.result.truncated,
      totalUrls: state.totalUrls,
      uniqueSvgCount: state.uniqueSvgCount,
      validCount: 0,
      brokenCount: 0,
      filterSafeCount: state.filter.filterSafeCount,
      aborted: abortFlag,
      sampled: state.result.sampled === true,
    },
  });
}

/** Above this many URLs, auto-validation is skipped entirely (millions of
 * HTTP requests would run for hours). Links remain fully usable. */
const VALIDATE_URL_CAP = 2_000_000;

async function runValidate(msg: { gen: number; concurrency: number }): Promise<void> {
  if (!state.result || state.totalUrls === 0) {
    post({ type: "done", gen: msg.gen, payload: { validCount: 0, brokenCount: 0, filterSafeCount: state.filter.filterSafeCount } });
    return;
  }
  abortFlag = false;
  // Scale guard: validating 2M+ URLs means millions of HTTP requests — it
  // would run for hours after generation already finished. Above the cap,
  // skip validation; links stay fully usable and downloadable.
  if (state.totalUrls > VALIDATE_URL_CAP) {
    post({
      type: "exportProgress",
      gen: msg.gen,
      message: `Skipped validation — ${state.totalUrls.toLocaleString()} links is beyond the validation cap (${VALIDATE_URL_CAP.toLocaleString()}). Downloads still include every link.`,
    });
    post({
      type: "done",
      gen: msg.gen,
      payload: { validCount: 0, brokenCount: 0, filterSafeCount: state.filter.filterSafeCount, skipped: true },
    });
    return;
  }
  const urls: string[] = [];
  for (const u of scopedUrls("all")) urls.push(u);
  try {
    const { valid, broken } = await validateLinks(urls, msg.concurrency, postValProgress, shouldAbort);
    state.validSet = new Set(valid);
    state.brokenSet = new Set(broken);
  } catch {
    // Validation is best-effort — keep generated links usable.
    state.validSet = new Set();
    state.brokenSet = new Set();
  }
  post({
    type: "done",
    gen: msg.gen,
    payload: { validCount: state.validSet.size, brokenCount: state.brokenSet.size, filterSafeCount: state.filter.filterSafeCount },
  });
}

/**
 * Filter check — the fast path. The LinkSet planner picks ≤200 probe
 * candidates per serving host (newest-commit coverage + deterministic
 * stride) WITHOUT walking the dataset, so a 45M-link run probes the same few
 * thousand targets as a 10k-link run. Pages/bunny URLs are grouped by their
 * REAL serving host (owner.github.io / zone.b-cdn.net) so host-level verdicts
 * apply to the right URLs. Counts are computed arithmetically from per-key
 * multiplicities instead of iterating every URL × filter.
 */
async function runFilters(msg: { gen: number; concurrency: number }): Promise<void> {
  const set = state.result?.set;
  if (!set || state.totalUrls === 0) {
    post({ type: "error", gen: msg.gen, message: "No links to check — generate first" });
    return;
  }
  abortFlag = false;
  try {
    const plan = buildFilterPlan(set);
    // The plan covers path-level candidates; each unique serving host also
    // gets one bare-host probe (host-level engines decide the unsampled bulk).
    const hosts = [...plan.hostTotals.keys()];
    const probeList = [...plan.urls, ...hosts.map((h) => `https://${h}/`)];
    const { results } = await checkDomains(
      probeList,
      Math.min(Math.max(msg.concurrency, 2), 24),
      postFilterProgress,
      shouldAbort,
    );
    state.filter.plan = plan;
    state.filter.byKey = new Map(results.map((r) => [r.domain, r] as const));
    state.filter.filterSampled = plan.sampled;

    // ── Arithmetic counting (see countFilterVerdicts) — O(plan × filters),
    // the full dataset is never walked.
    const counts = countFilterVerdicts(
      set,
      plan,
      state.filter.byKey,
      FILTER_DEFS.map((f) => f.name),
    );
    state.filter.blockedKeys = counts.blockedKeys;
    state.filter.filterSafeCount = counts.safeCount;
    const unblockedCounts: Record<string, number> = {};
    for (const f of FILTER_DEFS) unblockedCounts[f.name] = state.totalUrls - counts.perFilterBlocked[f.name];

    // UI card list — small (one entry per probed target).
    post({
      type: "done",
      gen: msg.gen,
      payload: {
        results,
        filterSafeCount: state.filter.filterSafeCount,
        unblockedCounts,
        sampled: plan.sampled,
      },
    });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Host part of a probe key ("cdn.jsdelivr.net/gh/..." → "cdn.jsdelivr.net"). */
function keyOfTargetDomain(key: string): string {
  return key.slice(0, key.indexOf("/")) || key;
}
void keyOfTargetDomain;

function statusOf(url: string, validateOn: boolean): "ok" | "bad" | "blocked" | "pending" | "off" {
  if (state.brokenSet.has(url)) return "bad";
  if (state.filter.blockedKeys.has(keyOf(url))) return "blocked";
  if (state.validSet.has(url)) return "ok";
  return validateOn ? "pending" : "off";
}

function runPage(msg: { gen: number; offset: number; limit: number; validateOn: boolean }): void {
  try {
    const set = state.result?.set;
    const rows: { repo: string; file: string; provider: string; url: string; status: string }[] = [];
    let hasMore = false;
    if (set) {
      for (const e of iterUrlEntries(set, { skip: msg.offset, take: msg.limit + 1 })) {
        if (rows.length >= msg.limit) {
          hasMore = true;
          break;
        }
        rows.push({
          repo: e.source,
          file: e.path.split("/").pop() ?? e.path,
          provider: e.provider.domain,
          url: e.url,
          status: statusOf(e.url, msg.validateOn),
        });
      }
    }
    post({ type: "page", gen: msg.gen, rows, hasMore });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

const COPY_CHAR_LIMIT = 400_000_000; // ~400M chars — clipboard ceiling guard

/** Post an export as a transferred buffer, or — when the payload is huge —
 * upload a lazy chunked Blob to Gofile and return the link instead. The
 * giant payload is NEVER materialized as one string/bytes copy. */
async function postExport(
  msg: { gen: number; filename: string },
  build: { chunks: string[] } | { bytes: Uint8Array; mime: string },
): Promise<void> {
  if ("bytes" in build) {
    const { bytes, mime } = build;
    if (shouldOffloadToGofile(null, bytes.byteLength)) {
      post({ type: "exportProgress", gen: msg.gen, payload: { message: `Large export (${Math.round(bytes.byteLength / 1048576)} MB) — uploading to Gofile.io…` } });
      const up = await uploadToGofile(new Blob([bytes.buffer as ArrayBuffer]), msg.filename);
      post({ type: "export", gen: msg.gen, filename: `GOFILE:${up.url}` });
      return;
    }
    post({ type: "export", gen: msg.gen, filename: msg.filename, mime, buf: bytes }, [bytes.buffer]);
    return;
  }
  // Chunk-built export: decide before joining — no double copy of huge data.
  const { chunks } = build;
  if (shouldOffloadToGofile(chunks, 0)) {
    const mb = Math.round(chunkSize(chunks) / 1048576);
    post({ type: "exportProgress", gen: msg.gen, payload: { message: `Large export (~${mb} MB) — uploading to Gofile.io…` } });
    const blob = new Blob(
      chunks.map((c) => new Blob([c], { type: "text/plain" })),
    );
    const up = await uploadToGofile(blob, msg.filename);
    post({ type: "export", gen: msg.gen, filename: `GOFILE:${up.url}` });
    return;
  }
  const bytes = new TextEncoder().encode(chunks.join(""));
  post({ type: "export", gen: msg.gen, filename: msg.filename, mime: "text/plain", buf: bytes }, [bytes.buffer]);
}

async function runCopyText(msg: { gen: number; scope: string }): Promise<void> {
  try {
    if (msg.scope === "safe" && !state.filter.plan) {
      throw new Error("No safe links yet — run the Filter Checker first");
    }
    const parts: string[] = [];
    let size = 0;
    for (const url of scopedUrls(msg.scope)) {
      size += url.length + 1;
      if (size > COPY_CHAR_LIMIT) throw new Error("Too many links to copy — use a download instead");
      parts.push(url);
    }
    post({ type: "copyText", gen: msg.gen, text: parts.join("\n") });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

async function runExport(msg: {
  gen: number;
  kind: "txt" | "csv" | "json" | "zip";
  scope: string;
  filename: string;
  filterName?: string;
}): Promise<void> {
  try {
    if (!state.result || state.totalUrls === 0) {
      throw new Error("Nothing to export — generate links first");
    }
    if (msg.scope === "safe" && !state.filter.plan) {
      throw new Error("No safe links yet — run the Filter Checker first");
    }

    // Per-filter unblocked export (Filter Checker panel buttons): keep URLs
    // whose per-filter verdict for THIS filter is unblocked (probed keys use
    // their merged verdict; unsampled keys inherit the host verdict).
    if (msg.filterName) {
      if (!state.filter.plan) throw new Error("Run the Filter Checker first");
      const byDomain = new Map<string, DomainFilterResult>();
      for (const r of state.filter.byKey.values()) {
        const d = keyOfTargetDomain(r.domain);
        if (r.domain === d) byDomain.set(d, r);
      }
      const chosen: string[] = [];
      for (const e of iterUrlEntries(state.result.set)) {
        const key = keyOf(e.url);
        const entry = state.filter.byKey.get(key);
        const domain = keyOfTargetDomain(key);
        const v = entry
          ? entry.results.find((x) => x.name === msg.filterName)
          : byDomain.get(domain)?.results.find((x) => x.name === msg.filterName);
        if (!v || v.error || !v.blocked) chosen.push(e.url);
      }
      const chunks: string[] = [];
      await buildTextChunks(chosen, (c) => chunks.push(c));
      await postExport(msg, { chunks });
      return;
    }

    if (msg.kind !== "zip") {
      // Single-file export: build chunked; small payloads join + transfer,
      // huge ones upload to Gofile straight from the chunks (never joined).
      const chunks: string[] = [];
      if (msg.kind === "txt") await buildTextChunks(scopedUrls(msg.scope), (c) => chunks.push(c));
      else if (msg.kind === "csv") await buildCsvChunks(scopedRows(msg.scope), (c) => chunks.push(c));
      else await buildJsonChunks(scopedJsonLinks(msg.scope), new Date().toISOString(), (c) => chunks.push(c));
      await postExport(msg, { chunks });
      return;
    }

    // ZIP: one .txt per provider + combined exports + README. Entries supply
    // their parts ON DEMAND — the zip builder materializes one entry at a
    // time and spools it into the payload Blob before the next loads, so a
    // 5-entry ZIP of 45M links never holds more than one dataset copy.
    const scope = msg.scope;
    const byProvider = new Map<string, string[]>();
    for (const s of state.result.set.slots) {
      if (!byProvider.has(s.provider.name)) byProvider.set(s.provider.name, []);
    }

    const entries: ZipLazyEntry[] = [];
    entries.push({
      name: `${scope === "all" ? "all" : scope}-links.txt`,
      parts: async () => {
        const chunks: string[] = [];
        await buildTextChunks(scopedUrls(scope), (c) => chunks.push(c));
        return chunks;
      },
    });
    entries.push({
      name: "links.csv",
      parts: async () => {
        const chunks: string[] = [];
        await buildCsvChunks(scopedRows(scope), (c) => chunks.push(c));
        return chunks;
      },
    });
    entries.push({
      name: "links.json",
      parts: async () => {
        const chunks: string[] = [];
        await buildJsonChunks(scopedJsonLinks(scope), new Date().toISOString(), (c) => chunks.push(c));
        return chunks;
      },
    });

    const scopedTotal =
      scope === "valid" ? state.validSet.size : scope === "safe" ? state.filter.filterSafeCount : state.totalUrls;
    entries.push({
      name: "README.txt",
      parts: async () => [
        [
          "CDN Link Studio export",
          `Generated: ${new Date().toISOString()}`,
          `Scope: ${scope} — ${scopedTotal.toLocaleString()} links`,
          `Providers: ${byProvider.size}`,
          "",
          "One .txt per provider is included.",
        ].join("\n"),
      ],
    });

    for (const [provider] of byProvider) {
      entries.push({
        name: `${provider.replace(/[^\w.-]+/g, "-")}.txt`,
        parts: async () => {
          const chunks: string[] = [];
          const urls = (function* (): Generator<string> {
            for (const e of iterUrlEntries(state.result!.set)) {
              if (e.provider.name === provider && inScope(e.url, scope)) yield e.url;
            }
          })();
          await buildTextChunks(urls, (c) => chunks.push(c));
          return chunks;
        },
      });
    }

    if (scope === "valid" && state.brokenSet.size > 0) {
      entries.push({ name: "broken-links.txt", parts: async () => [[...state.brokenSet].join("\n")] });
    }

    const zip = await buildZipLazy(entries);
    // The Blob is spooled (disk-backed for big payloads): decide the offload
    // from its size BEFORE materializing bytes for transfer.
    if (shouldOffloadToGofile(null, zip.size)) {
      post({ type: "exportProgress", gen: msg.gen, payload: { message: `Large export (${Math.round(zip.size / 1048576)} MB) — uploading to Gofile.io…` } });
      const up = await uploadToGofile(zip, msg.filename);
      post({ type: "export", gen: msg.gen, filename: `GOFILE:${up.url}` });
      return;
    }
    const zipBytes = new Uint8Array(await zip.arrayBuffer());
    await postExport(msg, { bytes: zipBytes, mime: "application/zip" });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as Record<string, unknown> & { type: string; gen: number };
  switch (msg.type) {
    case "generate":
      void runGenerate(msg as never);
      break;
    case "validate":
      void runValidate(msg as never);
      break;
    case "filters":
      void runFilters(msg as never);
      break;
    case "page":
      runPage(msg as never);
      break;
    case "copyText":
      void runCopyText(msg as never);
      break;
    case "export":
      void runExport(msg as never);
      break;
    case "abort":
      abortFlag = true;
      break;
    default:
      break;
  }
};
