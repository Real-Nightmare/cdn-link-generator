// Pipeline worker — the off-main-thread backend for Link Studio.
//
// Owns the ENTIRE generated dataset for its lifetime. The UI thread never
// receives the link array: it gets progress numbers, small summaries,
// page-sized table slices, copy strings and finished Blobs (transferred, not
// copied). This is what keeps multi-million-link runs from black-screening
// the page.

import {
  buildZipChunks,
  generateLinks,
  generatePackageLinks,
  type GenProgress,
  type GenResult,
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

interface WorkerState {
  result: GenResult | null;
  totalUrls: number;
  uniqueSvgCount: number;
  validSet: Set<string>;
  brokenSet: Set<string>;
  filterResults: DomainFilterResult[] | null;
  filterSafeSet: Set<string>;
  filterSafeCount: number;
}

const state: WorkerState = {
  result: null,
  totalUrls: 0,
  uniqueSvgCount: 0,
  validSet: new Set(),
  brokenSet: new Set(),
  filterResults: null,
  filterSafeSet: new Set(),
  filterSafeCount: 0,
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

/** Cheap URL→probe-key extraction — every generated URL is scheme://host/path
 * and `new URL()` costs ~50× more, which matters on million-link sets. The
 * key keeps host + path + query (scheme dropped) so the Filter Checker's
 * per-serving-URL verdicts match exactly. */
function hostOf(url: string): string {
  const schemeEnd = url.indexOf("://");
  const rest = schemeEnd === -1 ? url : url.slice(schemeEnd + 3);
  return rest.length > 1 && rest.endsWith("/") ? rest.slice(0, -1) : rest;
}

function recountState(): void {
  let urls = 0;
  const paths = new Set<string>();
  for (const l of state.result?.links ?? []) {
    urls += l.urls.length;
    paths.add(l.path);
  }
  state.totalUrls = urls;
  state.uniqueSvgCount = paths.size;
}

/** Rebuild the filter-safe URL set from the current per-serving-URL verdicts. */
function rebuildSafeSet(): void {
  state.filterSafeSet = new Set();
  if (state.filterResults && state.result) {
    const blocked = new Set(state.filterResults.filter((r) => r.blocked).map((r) => r.domain));
    for (const l of state.result.links) {
      for (const u of l.urls) {
        if (!blocked.has(hostOf(u.url))) state.filterSafeSet.add(u.url);
      }
    }
  }
  state.filterSafeCount = state.filterSafeSet.size;
}

function resetForNewRun(): void {
  abortFlag = false;
  state.result = null;
  state.totalUrls = 0;
  state.uniqueSvgCount = 0;
  state.validSet = new Set();
  state.brokenSet = new Set();
  state.filterResults = null;
  state.filterSafeSet = new Set();
  state.filterSafeCount = 0;
}

/** Lazy scoped URL iterator — never materializes the full array. */
function* scopedUrls(scope: string): Generator<string> {
  if (!state.result) return;
  for (const l of state.result.links) {
    for (const u of l.urls) {
      if (scope === "valid" ? state.validSet.has(u.url) : scope === "safe" ? state.filterSafeSet.has(u.url) : true) {
        yield u.url;
      }
    }
  }
}

/** Lazy scoped export-row iterator (for CSV). */
function* scopedRows(scope: string): Generator<ExportRow> {
  if (!state.result) return;
  for (const l of state.result.links) {
    for (const u of l.urls) {
      if (scope === "valid" ? state.validSet.has(u.url) : scope === "safe" ? state.filterSafeSet.has(u.url) : true) {
        yield {
          source: l.repo,
          path: l.path,
          commit: l.sha,
          provider: u.provider.name,
          domain: u.provider.domain,
          url: u.url,
        };
      }
    }
  }
}

/** Lazy scoped link iterator for the grouped JSON export — mirrors the
 * legacy linksToJSON shape (one object per SVG with all its URLs). */
function* scopedJsonLinks(scope: string): Generator<JsonLink> {
  if (!state.result) return;
  for (const l of state.result.links) {
    const urls = l.urls
      .filter((u) =>
        scope === "valid" ? state.validSet.has(u.url) : scope === "safe" ? state.filterSafeSet.has(u.url) : true,
      )
      .map((u) => ({ provider: u.provider.name, domain: u.provider.domain, url: u.url }));
    if (urls.length === 0) continue;
    yield { source: l.repo, path: l.path, ref: l.sha, urls };
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
}): Promise<void> {
  resetForNewRun();
  try {
    if (msg.mode === "repo") {
      state.result = await generateLinks(
        msg.repos,
        { commitsPerSVG: msg.commitsPerSVG, cdnSelection: msg.cdnSelection },
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
  recountState();
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
      filterSafeCount: state.filterSafeCount,
      aborted: abortFlag,
    },
  });
}

async function runValidate(msg: { gen: number; concurrency: number }): Promise<void> {
  if (!state.result || state.totalUrls === 0) {
    post({ type: "done", gen: msg.gen, payload: { validCount: 0, brokenCount: 0, filterSafeCount: state.filterSafeCount } });
    return;
  }
  abortFlag = false;
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
    payload: { validCount: state.validSet.size, brokenCount: state.brokenSet.size, filterSafeCount: state.filterSafeCount },
  });
}

async function runFilters(msg: { gen: number; concurrency: number }): Promise<void> {
  if (!state.result || state.totalUrls === 0) {
    post({ type: "error", gen: msg.gen, message: "No links to check — generate first" });
    return;
  }
  abortFlag = false;
  const urls: string[] = [];
  for (const u of scopedUrls("all")) urls.push(u);
  try {
    const results = await checkDomains(urls, Math.min(Math.max(msg.concurrency, 2), 24), postFilterProgress, shouldAbort);
    if (results.length > 0) state.filterResults = results;
    rebuildSafeSet();
    // Per-filter unblocked counts in one pass (worker-side, off the UI).
    const unblockedCounts: Record<string, number> = {};
    for (const f of FILTER_DEFS) unblockedCounts[f.name] = 0;
    const byDomain = new Map((state.filterResults ?? []).map((r) => [r.domain, r] as const));
    for (const l of state.result?.links ?? []) {
      for (const u of l.urls) {
        const dr = byDomain.get(hostOf(u.url));
        for (const f of FILTER_DEFS) {
          const entry = dr?.results.find((x) => x.name === f.name);
          if (!dr || !entry || entry.error || !entry.blocked) unblockedCounts[f.name]++;
        }
      }
    }
    post({
      type: "done",
      gen: msg.gen,
      payload: { results: state.filterResults ?? [], filterSafeCount: state.filterSafeCount, unblockedCounts },
    });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

function statusOf(url: string, validateOn: boolean): "ok" | "bad" | "blocked" | "pending" | "off" {
  if (state.brokenSet.has(url)) return "bad";
  if (state.filterResults && !state.filterSafeSet.has(url)) return "blocked";
  if (state.validSet.has(url)) return "ok";
  return validateOn ? "pending" : "off";
}

function runPage(msg: { gen: number; offset: number; limit: number; validateOn: boolean }): void {
  try {
    const rows: { repo: string; file: string; provider: string; url: string; status: string }[] = [];
    let skipped = 0;
    let hasMore = false;
    outer: for (const l of state.result?.links ?? []) {
      const file = l.path.split("/").pop() ?? l.path;
      for (const u of l.urls) {
        if (skipped < msg.offset) {
          skipped++;
          continue;
        }
        if (rows.length >= msg.limit) {
          hasMore = true;
          break outer;
        }
        rows.push({
          repo: l.repo,
          file,
          provider: u.provider.domain,
          url: u.url,
          status: statusOf(u.url, msg.validateOn),
        });
      }
    }
    post({ type: "page", gen: msg.gen, rows, hasMore });
  } catch (err) {
    post({ type: "error", gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
  }
}

const COPY_CHAR_LIMIT = 400_000_000; // ~400M chars — clipboard ceiling guard

async function runCopyText(msg: { gen: number; scope: string }): Promise<void> {
  try {
    if (msg.scope === "safe" && !state.filterResults) {
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
  try {    if (!state.result || state.totalUrls === 0) {
      throw new Error("Nothing to export — generate links first");
    }
    if (msg.scope === "safe" && !state.filterResults) {
      throw new Error("No safe links yet — run the Filter Checker first");
    }

    // Per-filter unblocked export (Filter Checker panel buttons).
    if (msg.filterName) {
      if (!state.filterResults) throw new Error("Run the Filter Checker first");
      const byDomain = new Map(state.filterResults.map((r) => [r.domain, r] as const));
      const chosen: string[] = [];
      for (const l of state.result.links) {
        for (const u of l.urls) {
          const dr = byDomain.get(hostOf(u.url));
          const entry = dr?.results.find((x) => x.name === msg.filterName);
          if (!dr || !entry || entry.error || !entry.blocked) chosen.push(u.url);
        }
      }
      const chunks: string[] = [];
      await buildTextChunks(chosen, (c) => chunks.push(c));
      const text = chunks.join("");
      const buf = new TextEncoder().encode(text);
      post({ type: "export", gen: msg.gen, filename: msg.filename, buf }, [buf.buffer]);
      return;
    }

    if (msg.kind !== "zip") {
      // Single-file export: build chunked, join in the worker, transfer bytes.
      const chunks: string[] = [];
      if (msg.kind === "txt") await buildTextChunks(scopedUrls(msg.scope), (c) => chunks.push(c));
      else if (msg.kind === "csv") await buildCsvChunks(scopedRows(msg.scope), (c) => chunks.push(c));
      else await buildJsonChunks(scopedJsonLinks(msg.scope), new Date().toISOString(), (c) => chunks.push(c));
      const bytes = new TextEncoder().encode(chunks.join(""));
      post({ type: "export", gen: msg.gen, filename: msg.filename, buf: bytes }, [bytes.buffer]);
      return;
    }

    // ZIP: one .txt per provider + combined exports + README.
    const rows = [...scopedRows(msg.scope)];
    const byProvider = new Map<string, string[]>();
    for (const r of rows) {
      const list = byProvider.get(r.provider) ?? [];
      list.push(r.url);
      byProvider.set(r.provider, list);
    }
    const urls = [...scopedUrls(msg.scope)];
    const entries: { name: string; chunks: string[] }[] = [];

    const allChunks: string[] = [];
    await buildTextChunks(urls, (c) => allChunks.push(c));
    entries.push({ name: `${msg.scope === "all" ? "all" : msg.scope}-links.txt`, chunks: allChunks });

    const csvChunks: string[] = [];
    await buildCsvChunks(scopedRows(msg.scope), (c) => csvChunks.push(c));
    entries.push({ name: "links.csv", chunks: csvChunks });

    const jsonChunks: string[] = [];
    await buildJsonChunks(scopedJsonLinks(msg.scope), new Date().toISOString(), (c) => jsonChunks.push(c));
    entries.push({ name: "links.json", chunks: jsonChunks });

    entries.push({
      name: "README.txt",
      chunks: [
        [
          "CDN Link Studio export",
          `Generated: ${new Date().toISOString()}`,
          `Scope: ${msg.scope} — ${urls.length} links`,
          `Providers: ${byProvider.size}`,
          "",
          "One .txt per provider is included.",
        ].join("\n"),
      ],
    });

    for (const [provider, list] of byProvider) {
      const chunks: string[] = [];
      await buildTextChunks(list, (c) => chunks.push(c));
      entries.push({ name: `${provider.replace(/[^\w.-]+/g, "-")}.txt`, chunks });
    }

    if (msg.scope === "valid" && state.brokenSet.size > 0) {
      const chunks: string[] = [];
      await buildTextChunks(state.brokenSet, (c) => chunks.push(c));
      entries.push({ name: "broken-links.txt", chunks });
    }

    const zip = buildZipChunks(entries);
    const zipBytes = new Uint8Array(await zip.arrayBuffer());
    post({ type: "export", gen: msg.gen, filename: msg.filename, buf: zipBytes }, [zipBytes.buffer]);
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
