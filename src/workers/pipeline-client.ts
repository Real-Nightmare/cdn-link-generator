// Main-thread client for the pipeline worker.
//
// Every heavy operation (generation, validation, filter checks, exports,
// table paging, copy-text assembly) runs inside the worker; the UI thread
// only renders lightweight state and receives transferred Buffers/Blobs.

export interface GenProgressPayload {
  phase: "repos" | "svgs" | "commits" | "links" | "done";
  current: number;
  total: number;
  label: string;
}

export interface RunSummary {
  repos: { repo: string; error?: string; svgCount: number }[];
  truncated: boolean;
  totalUrls: number;
  uniqueSvgCount: number;
  validCount: number;
  brokenCount: number;
  filterSafeCount: number;
  aborted: boolean;
  /** Commit history was sampled to fit the URL budget — coverage note shown. */
  sampled?: boolean;
}

export interface TablePage {
  rows: { repo: string; file: string; provider: string; url: string; status: string }[];
  hasMore: boolean;
}

export interface FilterDone {
  results: {
    domain: string;
    blocked: boolean;
    results: { name: string; blocked: boolean; error?: string }[];
  }[];
  filterSafeCount: number;
  /** Per-filter count of URLs the filter actually answered and did NOT block. */
  unblockedCounts: Record<string, number>;
  /** Per-filter count of URLs the filter VERIFIED as blocked — link-weighted,
   * matches the "blocked by X" per-filter download exactly. */
  blockedCounts?: Record<string, number>;
  /** Per-filter count of URLs the filter produced NO verdict for (timeout,
   * endpoint down, socket blocked) — shown separately, never folded into
   * "unblocked". */
  unverifiedCounts?: Record<string, number>;
  /** Per-serving-host probe coverage: links behind the host, DISTINCT paths
   * it serves, and how many of those paths were actually probed. Host-keyed
   * engines (Lightspeed, DNS, Deledao, Barracuda) verdict every link on the
   * host; path-aware engines are verified only on probed paths. */
  hostCoverage?: { host: string; urls: number; distinctPaths: number; probed: number }[];
  /** True when a host serves more distinct paths than its probe budget —
   * path-aware verdicts on unprobed paths stay unverified (never guessed). */
  sampled?: boolean;
}

type ProgressHandler = (kind: "gen" | "validate" | "filters", payload: unknown) => void;

// Standard worker constructor — Vite bundles ./pipeline-worker.ts as its own
// chunk for both dev and build (no ?worker suffix needed).
function createWorker(): Worker {
  return new Worker(new URL("./pipeline-worker.ts", import.meta.url), { type: "module" });
}

let worker: Worker | null = null;
let genCounter = 0;
const pending = new Map<
  number,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    onProgress?: ProgressHandler;
  }
>();

function getWorker(): Worker {
  if (!worker) {
    const w = createWorker();
    worker = w;
    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        type: string;
        gen: number;
        payload?: unknown;
        message?: string;
        rows?: TablePage["rows"];
        hasMore?: boolean;
        text?: string;
        buf?: ArrayBuffer;
        filename?: string;
        kind?: string;
      };
      const entry = pending.get(msg.gen);
      if (msg.type === "progress" && entry?.onProgress) {
        entry.onProgress((msg.kind ?? "gen") as "gen" | "validate" | "filters", msg.payload);
        return;
      }
      if (!entry) return;
      pending.delete(msg.gen);
      if (msg.type === "error") {
        entry.reject(new Error(msg.message ?? "Worker error"));
      } else if (msg.type === "done") {
        entry.resolve(msg.payload);
      } else if (msg.type === "page") {
        entry.resolve({ rows: msg.rows ?? [], hasMore: !!msg.hasMore });
      } else if (msg.type === "copyText") {
        entry.resolve(msg.text ?? "");
      } else if (msg.type === "export") {
        entry.resolve({ buf: msg.buf, filename: msg.filename });
      } else if (msg.type === "exportProgress") {
        // One-off status note (validation skipped, Gofile upload started).
        // Console only — the UI surfaces outcomes via results/filenames.
        const p = msg.payload as { message?: string } | undefined;
        if (p?.message) console.info(`[worker] ${p.message}`);
      }
    };
    w.onerror = (ev) => {
      // Worker crashed (OOM, syntax error, …): fail every pending call so the
      // UI surfaces an error instead of hanging forever.
      const err = new Error(`Background worker error: ${ev.message || "unknown"}`);
      for (const [gen, entry] of pending) {
        pending.delete(gen);
        entry.reject(err);
      }
    };
  }
  return worker as Worker;
}

/** Strip values that can't survive structured clone (functions, DOM nodes).
 * Callers pass progress callbacks alongside data; without this every post
 * throws "could not be cloned" in a real browser. */
function cloneable<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "function") out[k] = v;
  }
  return out;
}

function call<T>(
  type: string,
  args: Record<string, unknown>,
  onProgress?: ProgressHandler,
): Promise<T> {
  const gen = ++genCounter;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(gen, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    try {
      w.postMessage({ type, gen, ...cloneable(args) });
    } catch (err) {
      pending.delete(gen);
      reject(new Error(`Failed to start background task: ${err instanceof Error ? err.message : String(err)}`));
    }
  });
}

export const pipeline = {
  /** Full generation run (repo or npm mode). Validation runs separately. */
  generate(args: {
    mode: "repo" | "npm";
    repos: { owner: string; name: string }[];
    npmPkg: string;
    versions: string[];
    commitsPerSVG: number;
    cdnSelection: string[];
    token: string;
    bunnyZone: string;
    /** Max URL objects the worker may hold (commit sampling threshold). */
    urlBudget: number;
    onProgress: (p: GenProgressPayload) => void;
  }): Promise<RunSummary> {
    return call<RunSummary>("generate", args, (kind, payload) => {
      if (kind === "gen") args.onProgress(payload as GenProgressPayload);
    });
  },

  validate(args: {
    concurrency: number;
    onProgress: (done: number, total: number) => void;
  }): Promise<{ validCount: number; brokenCount: number; skipped?: boolean }> {
    return call("validate", { concurrency: args.concurrency }, (kind, payload) => {
      if (kind === "validate") {
        const p = payload as { done: number; total: number };
        args.onProgress(p.done, p.total);
      }
    }) as Promise<{ validCount: number; brokenCount: number; skipped?: boolean }>;
  },

  runFilters(args: {
    concurrency: number;
    onProgress: (done: number, total: number) => void;
  }): Promise<FilterDone> {
    return call("filters", { concurrency: args.concurrency }, (kind, payload) => {
      if (kind === "filters") {
        const p = payload as { done: number; total: number };
        args.onProgress(p.done, p.total);
      }
    }) as Promise<FilterDone>;
  },

  page(offset: number, limit: number, validateOn: boolean): Promise<TablePage> {
    return call("page", { offset, limit, validateOn });
  },

  copyText(scope: "all" | "valid" | "safe"): Promise<string> {
    return call("copyText", { scope }) as Promise<string>;
  },

  export(args: {
    kind: "txt" | "csv" | "json" | "zip";
    scope: "all" | "valid" | "safe";
    filename: string;
    filterName?: string;
    /** Direction for per-filter exports: "clear" (default) or "blocked". */
    filterMode?: "clear" | "blocked";
  }): Promise<{ buf: ArrayBuffer; filename: string }> {
    return call("export", args) as Promise<{ buf: ArrayBuffer; filename: string }>;
  },

  abort(): void {
    abortAll();
  },
};

export function abortAll(): void {
  getWorker().postMessage({ type: "abort", gen: 0 });
}

/** Build a download from a worker-returned ArrayBuffer. */
export function downloadBuffer(buf: ArrayBuffer, filename: string, mime = "text/plain"): void {
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Copy text produced inside the worker (avoids shipping the whole dataset
 * to the main thread for the clipboard). */
export async function copyFromWorker(scope: "all" | "valid" | "safe"): Promise<string> {
  const text = await pipeline.copyText(scope);
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok ? "copied" : "failed";
  }
}
