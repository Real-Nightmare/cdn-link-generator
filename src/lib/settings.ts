// Settings persistence — the browser replacement for ~/.cdn_settings.json.
// All state lives in localStorage; nothing leaves the user's machine except
// the GitHub API calls they trigger.

export type DownloadScope = "all" | "valid" | "safe";

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
