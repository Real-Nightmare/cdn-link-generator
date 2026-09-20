// CDN provider registry — every URL format below was live-tested (HTTP 200 +
// image/svg+xml) against a real GitHub commit and npm package.

export type CDNFormat =
  | "gh" // /gh/{owner}/{repo}@{sha}/{path} — jsDelivr & mirrors
  | "static" // /gh/{owner}/{repo}/{sha}/{path} — StaticDelivr (no @ — live-tested)
  | "statically" // /gh/{owner}/{repo}@{sha}/{path} — Statically (@ shape required)
  | "raw" // /{owner}/{repo}/{sha}/{path} — githubraw, Githack
  | "ghraw" // raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}
  | "esm" // /gh/{owner}/{repo}@{sha}/{path} — esm.sh
  | "proxy" // /https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}
  | "npm" // /npm/{package}/{path} — jsDelivr npm
  | "npmunpkg" // /{package}/{path} — unpkg
  | "pages" // https://{owner}.github.io/{repo}/{path}
  | "bunny"; // https://{zone}.b-cdn.net/{path} — needs a Bunny pull zone

export type CDNCategory = "jsdelivr" | "proxy" | "esm" | "npm";

export interface CDNProvider {
  id: number;
  name: string;
  domain: string;
  format: CDNFormat;
  svgOnly: boolean;
  category: CDNCategory;
  /** Hint shown in the UI tooltip. */
  note?: string;
  /** Off by default — the user must opt in. */
  optional?: boolean;
  /** Only builds URLs when an npm package is supplied. */
  requires?: "package";
  /** Only builds URLs when the user supplies their own infrastructure (e.g. a Bunny pull zone name). */
  requiresOwnHost?: boolean;
}

export const CDN_PROVIDERS: CDNProvider[] = [
  // --- jsDelivr network + mirrors ---
  { id: 1, name: "jsDelivr (Primary)", domain: "cdn.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 2, name: "jsDelivr (Fastly)", domain: "fastly.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 3, name: "jsDelivr (Gcore)", domain: "gcore.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 4, name: "jsDelivr (Testing CF)", domain: "testingcf.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 5, name: "jsDelivr (Quantil)", domain: "quantil.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 6, name: "jsDelivr (Origin Fastly)", domain: "originfastly.jsdelivr.net", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 7, name: "StaticDelivr", domain: "cdn.staticdelivr.com", format: "static", svgOnly: false, category: "jsdelivr" },
  { id: 8, name: "jsDelivr CN", domain: "jsd.onmicrosoft.cn", format: "gh", svgOnly: false, category: "jsdelivr" },
  { id: 9, name: "jsDelivr Mirror", domain: "cdn.jsdmirror.com", format: "gh", svgOnly: false, category: "jsdelivr" },

  // --- GitHub proxies ---
  { id: 10, name: "GitHub Raw", domain: "githubraw.com", format: "raw", svgOnly: true, category: "proxy" },
  { id: 11, name: "GitHub Raw (CDN)", domain: "cdn.githubraw.com", format: "raw", svgOnly: true, category: "proxy" },
  { id: 12, name: "Githack", domain: "raw.githack.com", format: "raw", svgOnly: true, category: "proxy", note: "Dev mode — short cache" },
  { id: 13, name: "Githack (CDN)", domain: "rawcdn.githack.com", format: "raw", svgOnly: true, category: "proxy", note: "Long cache — best for hotlinks" },
  { id: 14, name: "Statically", domain: "cdn.statically.io", format: "statically", svgOnly: false, category: "proxy" },
  {
    id: 15,
    name: "GitHub Raw (Official)",
    domain: "raw.githubusercontent.com",
    format: "ghraw",
    svgOnly: false,
    category: "proxy",
    note: "Can serve text/plain — fine for <img>, not for direct visits on some browsers",
  },
  {
    id: 17,
    name: "gh-proxy.com",
    domain: "gh-proxy.com",
    format: "proxy",
    svgOnly: true,
    category: "proxy",
    optional: true,
    note: "Proxy wrapper — serves image/svg+xml",
  },
  {
    id: 18,
    name: "ghproxy.net",
    domain: "ghproxy.net",
    format: "proxy",
    svgOnly: true,
    category: "proxy",
    optional: true,
    note: "Proxy wrapper — serves image/svg+xml",
  },
  {
    id: 23,
    name: "gh.llkk.cc",
    domain: "gh.llkk.cc",
    format: "proxy",
    svgOnly: true,
    category: "proxy",
    optional: true,
    note: "Proxy wrapper — serves image/svg+xml (live-tested)",
  },
  {
    id: 24,
    name: "ghfast.top",
    domain: "ghfast.top",
    format: "proxy",
    svgOnly: true,
    category: "proxy",
    optional: true,
    note: "Proxy wrapper — serves image/svg+xml (live-tested)",
  },
  {
    id: 21,
    name: "GitHub Pages",
    domain: "github.io",
    format: "pages",
    svgOnly: true,
    category: "proxy",
    optional: true,
    note: "Only works if the repo has a Pages site (e.g. pushed to gh-pages)",
  },

  // --- ESM CDNs ---
  { id: 16, name: "esm.sh", domain: "esm.sh", format: "esm", svgOnly: false, category: "esm" },

  // --- npm package CDNs (need the package field) ---
  {
    id: 19,
    name: "UNPKG",
    domain: "unpkg.com",
    format: "npmunpkg",
    svgOnly: true,
    category: "npm",
    optional: true,
    requires: "package",
    note: "Serves any SVG inside an npm package — image/svg+xml",
  },
  {
    id: 20,
    name: "jsDelivr npm",
    domain: "cdn.jsdelivr.net",
    format: "npm",
    svgOnly: true,
    category: "npm",
    optional: true,
    requires: "package",
    note: "Serves any SVG inside an npm package — image/svg+xml",
  },
  {
    id: 22,
    name: "Bunny CDN",
    domain: "b-cdn.net",
    format: "bunny",
    svgOnly: false,
    category: "proxy",
    optional: true,
    requiresOwnHost: true,
    note: "Your Bunny pull zone backed by the repo — add the zone name in Settings",
  },
];

export const CATEGORY_LABELS: Record<CDNCategory, string> = {
  jsdelivr: "jsDelivr network & mirrors",
  proxy: "GitHub proxies",
  esm: "ESM CDNs",
  npm: "npm package CDNs",
};

/** Providers that work with zero extra input. */
export function defaultProviderIds(): number[] {
  return CDN_PROVIDERS.filter((c) => !c.optional && !c.requires && !c.requiresOwnHost).map((c) => c.id);
}

export interface CDNPreset {
  id: string;
  label: string;
  description: string;
  ids: number[] | "all" | "default";
}

export const CDN_PRESETS: CDNPreset[] = [
  {
    id: "recommended",
    label: "Recommended",
    description: "jsDelivr, githubraw, Githack, Statically and esm.sh — the proven set",
    ids: [1, 10, 12, 14, 16],
  },
  {
    id: "standard",
    label: "Standard",
    description: "Everything that works out of the box — no package or Pages setup needed",
    ids: "default",
  },
  {
    id: "ubg",
    label: "UBG bulk",
    description: "Maximum link volume: all GitHub-backed CDNs including proxies (Bunny needs your zone)",
    ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 22, 23, 24],
  },
  {
    id: "mirrors",
    label: "jsDelivr only",
    description: "jsDelivr network plus every mirror",
    ids: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  },
  {
    id: "all",
    label: "Everything",
    description: `All ${CDN_PROVIDERS.length} providers — npm CDNs need a package name, Bunny needs your zone`,
    ids: "all",
  },
];

/** Resolve a preset to a concrete list of provider ids. */
export function applyPreset(preset: CDNPreset): number[] {
  if (preset.ids === "default") return defaultProviderIds();
  if (preset.ids === "all") return CDN_PROVIDERS.map((c) => c.id);
  return [...preset.ids];
}

/** Encode every path segment so spaces, #, ? and unicode can't break the URL. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * Build a CDN URL for one file at one commit on one provider.
 * In npm mode `sha` carries the package version and `pkg` the package name;
 * both npm formats pin the version — unpinned URLs 302-redirect (unpkg) or
 * silently serve the latest release (jsDelivr npm) instead of what you picked.
 */
export function generateCDNLink(
  owner: string,
  repo: string,
  sha: string,
  path: string,
  provider: CDNProvider,
  pkg?: string,
  zoneOverride?: string,
): string {
  const p = encodePath(path);
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${p}`;
  switch (provider.format) {
    case "static": // StaticDelivr — live-tested: no @ (the @ shape 404s here)
      return `https://${provider.domain}/gh/${owner}/${repo}/${sha}/${p}`;
    case "statically": // Statically — live-tested: @ shape serves 200 https directly
      return `https://${provider.domain}/gh/${owner}/${repo}@${sha}/${p}`;
    case "raw":
      return `https://${provider.domain}/${owner}/${repo}/${sha}/${p}`;
    case "ghraw":
      return raw;
    case "esm":
      return `https://${provider.domain}/gh/${owner}/${repo}@${sha}/${p}`;
    case "proxy":
      return `https://${provider.domain}/${raw}`;
    case "npm":
      return `https://${provider.domain}/npm/${pkg}@${sha}/${p}`;
    case "npmunpkg":
      return `https://${provider.domain}/${pkg}@${sha}/${p}`;
    case "pages":
      return `https://${owner}.github.io/${repo}/${p}`;
    case "bunny": {
      // Bunny pull zone: configure the zone to mirror raw.githubusercontent.com
      // (origin URL), so the path after the zone is the full raw URL.
      const zone = (zoneOverride || bunnyZone || "").replace(/[^a-z0-9-]/g, "");
      if (!zone) return ""; // no zone configured — caller filters empties out
      return `https://${zone}.b-cdn.net/${raw}`;
    }
    default: // gh — jsDelivr style: /gh/owner/repo@commit/path
      return `https://${provider.domain}/gh/${owner}/${repo}@${sha}/${p}`;
  }
}

/** The user's Bunny pull zone (Settings → Bunny CDN). Empty = bunny disabled. */
let bunnyZone = "";
export function setBunnyZone(zone: string): void {
  bunnyZone = zone.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}
export function getBunnyZone(): string {
  return bunnyZone;
}
export function bunnyReady(): boolean {
  return bunnyZone.length >= 3;
}

/** Select providers by id, name fragment or domain fragment (case-insensitive). */
export function selectCDNs(selection: string[]): CDNProvider[] {
  if (selection.length === 0) return CDN_PROVIDERS;
  const chosen: CDNProvider[] = [];
  const seen = new Set<number>();
  for (const selRaw of selection) {
    const sel = selRaw.trim().toLowerCase();
    if (!sel) continue;
    const match = CDN_PROVIDERS.find(
      (c) =>
        !seen.has(c.id) &&
        (String(c.id) === sel ||
          c.name.toLowerCase().includes(sel) ||
          c.domain.toLowerCase().includes(sel)),
    );
    if (match) {
      chosen.push(match);
      seen.add(match.id);
    }
  }
  return chosen;
}

export function findCDN(id: number): CDNProvider | undefined {
  return CDN_PROVIDERS.find((c) => c.id === id);
}
