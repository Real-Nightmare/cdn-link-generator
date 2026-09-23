// Settings persistence — the browser replacement for ~/.cdn_settings.json.
// All state lives in localStorage; nothing leaves the user's machine except
// the GitHub API calls they trigger.

export type DownloadScope = "all" | "valid" | "safe";

/** Default ceiling on URL objects held in the worker (repo mode). 10k files
 * × 100 commits × 24 providers ≈ 24M URLs → OOM = silent death, so commits
 * are sampled to fit this budget. Users can raise/lower it in Settings. */
export const DEFAULT_URL_BUDGET = 5_000_000;
/** Hard clamp for the user-editable budget — up to 50M URL objects as a
 * user choice. Beyond the default, commit sampling trades history depth for
 * memory; huge budgets rely on the hard safety stop + Gofile offload. */
export const MAX_URL_BUDGET_CLAMP = 50_000_000;
export const MIN_URL_BUDGET = 100_000;

export interface AppSettings {
  token: string;
  commitsPerSVG: number;
  cdnSelection: string[];
  concurrency: number;
  validate: boolean;
  lastRepos: string[];
  npmPkg: string;
  lastPreset: string;
  /** Which links copy/download exports include: everything, validated-only, or filter-safe-only. */
  downloadScope: DownloadScope;
  /** Bunny CDN pull zone name (b-cdn.net subdomain), empty when unused. */
  bunnyZone: string;
  /** BYOD IPs/hosts (raw textarea text, newline/comma separated). Each parsed
   * host becomes an extra serving-host slot — more links per asset. */
  byodHosts: string;
  /** Max URL objects the worker may hold during repo-mode generation.
   * Above it, commit history is sampled (newest always kept). */
  urlBudget: number;
}

const KEY = "cdn-studio-settings-v1";

export function defaultSettings(): AppSettings {
  return {
    token: "",
    commitsPerSVG: 0, // all fetched commits
    cdnSelection: [],
    concurrency: 128,
    validate: true,
    lastRepos: [],
    npmPkg: "",
    lastPreset: "standard",
    downloadScope: "all",
    bunnyZone: "",
    byodHosts: "",
    urlBudget: DEFAULT_URL_BUDGET,
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    const stored = JSON.parse(raw) as Partial<AppSettings>;
    const d = defaultSettings();
    return {
      token: typeof stored.token === "string" ? stored.token : d.token,
      commitsPerSVG:
        typeof stored.commitsPerSVG === "number" && stored.commitsPerSVG >= 0
          ? stored.commitsPerSVG
          : d.commitsPerSVG,
      cdnSelection: Array.isArray(stored.cdnSelection) ? stored.cdnSelection : d.cdnSelection,
      concurrency:
        typeof stored.concurrency === "number" && stored.concurrency > 0
          ? Math.min(stored.concurrency, 512)
          : d.concurrency,
      validate: typeof stored.validate === "boolean" ? stored.validate : d.validate,
      lastRepos: Array.isArray(stored.lastRepos) ? stored.lastRepos.slice(0, 10) : [],
      npmPkg: typeof stored.npmPkg === "string" ? stored.npmPkg : d.npmPkg,
      lastPreset: typeof stored.lastPreset === "string" ? stored.lastPreset : d.lastPreset,
      downloadScope:
        stored.downloadScope === "valid" || stored.downloadScope === "safe"
          ? stored.downloadScope
          : "all",
      bunnyZone: typeof stored.bunnyZone === "string" ? stored.bunnyZone : "",
      byodHosts: typeof stored.byodHosts === "string" ? stored.byodHosts.slice(0, 16_000) : "",
      urlBudget:
        typeof stored.urlBudget === "number" && stored.urlBudget >= MIN_URL_BUDGET
          ? Math.min(Math.floor(stored.urlBudget), MAX_URL_BUDGET_CLAMP)
          : d.urlBudget,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked — non-fatal
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Read just the saved GitHub token without loading the whole settings object. */
export function readStoredToken(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? ((JSON.parse(raw) as { token?: string }).token ?? "") : "";
  } catch {
    return "";
  }
}
