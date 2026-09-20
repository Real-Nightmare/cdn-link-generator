// Link generation pipeline — repo mode (scan → history → links) and
// npm package mode (versions → package files → links). All client-side.

import { CDNProvider, generateCDNLink, selectCDNs, bunnyReady } from "./cdns";
import { GitHubRepo, getCommitSHAs, getPackageSVGs, getSVGFiles, getTreeForCommit } from "./github";
import { DEFAULT_URL_BUDGET } from "./settings";

export interface GenOptions {
  commitsPerSVG: number; // 0 = all fetched commits (repo mode)
  cdnSelection: string[]; // empty = all providers
  /** Max URL objects to hold (repo mode). Defaults to the settings default. */
  urlBudget?: number;
}

export interface GenProgress {
  phase: "repos" | "svgs" | "commits" | "links" | "done";
  current: number;
  total: number;
  label: string;
}

export interface RepoResult {
  repo: string;
  error?: string;
  svgCount: number;
}

export interface GeneratedLink {
  repo: string; // "owner/repo" or "pkg@version" in npm mode
  path: string;
  sha: string;
  urls: { provider: CDNProvider; url: string }[];
}

export interface GenResult {
  repos: RepoResult[];
  links: GeneratedLink[];
  truncated: boolean;
  /** True when commit history was sampled (files × commits × providers would
   * have blown the memory budget). The summary message says so. */
  sampled?: boolean;
}

/** Sample `shas` down so files × commits × providers stays inside the URL
 * budget. Deterministic even sampling (never just the newest N, which would
 * miss history); always keeps the newest commit. */
export function sampleCommits(
  fileCount: number,
  shas: string[],
  providerCount: number,
  budget: number,
): { shas: string[]; sampled: boolean } {
  if (fileCount === 0 || providerCount === 0) return { shas, sampled: false };
  const maxCommits = Math.max(1, Math.floor(budget / (fileCount * providerCount)));
  if (shas.length <= maxCommits) return { shas, sampled: false };
  const stride = shas.length / maxCommits;
  const picked: string[] = [];
  for (let i = 0; i < maxCommits; i++) picked.push(shas[Math.floor(i * stride)]);
  // Guarantee the newest commit is present (users check the live state).
  if (!picked.includes(shas[0])) picked[0] = shas[0];
  return { shas: picked, sampled: true };
}

/** Generate links for every SVG across every repo, streaming progress. */
export async function generateLinks(
  repos: GitHubRepo[],
  opts: GenOptions,
  token: string | undefined,
  onProgress: (p: GenProgress) => void,
  shouldAbort?: () => boolean,
  bunnyZoneName?: string,
): Promise<GenResult> {
  // npm-only providers can't build repo links — exclude them here.
  const providers = selectCDNs(opts.cdnSelection).filter(
    (p) => p.format !== "npm" && p.format !== "npmunpkg",
  );
  const result: GenResult = { repos: [], links: [], truncated: false };

  // Phase 1: scan each repo for SVGs (per-repo error isolation).
  for (let i = 0; i < repos.length; i++) {
    if (shouldAbort?.()) return result;
    const repo = repos[i];
    const key = `${repo.owner}/${repo.name}`;
    onProgress({
      phase: "repos",
      current: i + 1,
      total: repos.length,
      label: `Scanning ${key}…`,
    });
    try {
      const { files, truncated } = await getSVGFiles(repo, token);
      if (truncated) result.truncated = true;
      result.repos.push({ repo: key, svgCount: files.length });
      if (files.length === 0) continue;

      // Phase 2: fetch commit SHAs.
      onProgress({
        phase: "commits",
        current: i + 1,
        total: repos.length,
        label: `Fetching commits for ${key}…`,
      });
      const count = opts.commitsPerSVG > 0 ? opts.commitsPerSVG : files.length;
      let shas = await getCommitSHAs(repo, count, token);
      if (shas.length === 0) {
        result.repos.push({ repo: key, error: "no commits found", svgCount: files.length });
        continue;
      }
      // Memory guard: 10k files × 100 commits × 24 providers would build
      // ~24M URL objects and kill the worker. Sample commits, keep newest.
      const budget = opts.urlBudget ?? DEFAULT_URL_BUDGET;
      const { shas: usable, sampled } = sampleCommits(files.length, shas, providers.length, budget);
      shas = usable;
      if (sampled) result.sampled = true;

      // Phase 3: build links — parallel-fetch commit trees (bounded, memory
      // stays ~TREES_IN_FLIGHT trees) and emit links as each lands. The old
      // one-at-a-time loop was the "stuck reading all commits" stall: a
      // single hung tree request froze the entire links phase with no error.
      onProgress({
        phase: "links",
        current: i + 1,
        total: repos.length,
        label: `Generating links for ${key}…`,
      });
      const bunny = bunnyReady();
      let treeDone = 0;
      let built = 0;
      const TREES_IN_FLIGHT = 6;
      links: for (let start = 0; start < shas.length; start += TREES_IN_FLIGHT) {
        if (shouldAbort?.()) return result;
        const batch = shas.slice(start, start + TREES_IN_FLIGHT);
        const trees = await Promise.all(
          batch.map(async (sha) => {
            try {
              return { sha, tree: await getTreeForCommit(repo, sha, token) };
            } catch {
              return { sha, tree: null }; // commit unreachable — skip it
            }
          }),
        );
        for (const { sha, tree } of trees) {
          if (!tree) continue;
          for (const path of tree) {
            const urls = providers
              .map((provider) => ({
                provider,
                url: generateCDNLink(
                  repo.owner,
                  repo.name,
                  sha,
                  path,
                  provider,
                  undefined,
                  bunny ? bunnyZoneName : undefined,
                ),
              }))
              .filter((u) => u.url !== "");
            if (urls.length === 0) continue;
            result.links.push({ repo: key, path, sha, urls });
            built += urls.length;
            if (built > budget * 1.2) break links; // hard safety stop
          }
          treeDone++;
          onProgress({
            phase: "links",
            current: treeDone,
            total: shas.length,
            label: `${key}: commit ${treeDone}/${shas.length} — ${built.toLocaleString()} links so far`,
          });
        }
      }
    } catch (err) {
      result.repos.push({
        repo: key,
        error: err instanceof Error ? err.message : String(err),
        svgCount: 0,
      });
    }
  }

  if (result.links.length === 0 && result.repos.every((r) => !r.error)) {
    throw new Error("No SVG files found in any of the repositories");
  }
  onProgress({ phase: "done", current: 1, total: 1, label: "Complete" });
  return result;
}
/**
 * npm package mode: every SVG inside the package's files, replicated across
 * the selected versions and every npm-capable provider.
 */
export async function generatePackageLinks(
  pkg: string,
  versions: string[],
  opts: GenOptions,
  onProgress: (p: GenProgress) => void,
  shouldAbort?: () => boolean,
): Promise<GenResult> {
  const providers = selectCDNs(opts.cdnSelection).filter(
    (p) => p.format === "npm" || p.format === "npmunpkg",
  );
  const result: GenResult = { repos: [], links: [], truncated: false };

  const versionsToUse =
    opts.commitsPerSVG > 0 ? versions.slice(0, opts.commitsPerSVG) : versions;

  for (let v = 0; v < versionsToUse.length; v++) {
    if (shouldAbort?.()) return result;
    const version = versionsToUse[v];
    onProgress({
      phase: "repos",
      current: v + 1,
      total: versionsToUse.length,
      label: `Listing ${pkg}@${version}…`,
    });
    try {
      const files = await getPackageSVGs(pkg, version);
      result.repos.push({ repo: `${pkg}@${version}`, svgCount: files.length });
      if (files.length === 0) continue;

      onProgress({
        phase: "links",
        current: v + 1,
        total: versionsToUse.length,
        label: `Generating links for ${pkg}@${version}…`,
      });
      let done = 0;
      for (const path of files) {
        const urls = providers
          .map((provider) => ({
            provider,
            url: generateCDNLink(pkg, "", version, path, provider, pkg),
          }))
          .filter((u) => u.url !== "");
        if (urls.length === 0) continue;
        result.links.push({
          repo: `${pkg}@${version}`,
          path,
          sha: version,
          urls,
        });
        done++;
        onProgress({
          phase: "links",
          current: done,
          total: files.length,
          label: `${pkg}@${version}: ${done}/${files.length} SVGs`,
        });
      }
    } catch (err) {
      result.repos.push({
        repo: `${pkg}@${version}`,
        error: err instanceof Error ? err.message : String(err),
        svgCount: 0,
      });
    }
  }

  if (result.links.length === 0 && result.repos.every((r) => !r.error)) {
    throw new Error(`No SVG files found in ${pkg} (any version)`);
  }
  onProgress({ phase: "done", current: 1, total: 1, label: "Complete" });
  return result;
}

/** Flatten links to plain URL lines (for copy/download). */
export function linksToText(links: GeneratedLink[]): string {
  return links.flatMap((l) => l.urls.map((u) => u.url)).join("\n");
}

/** Flatten links to CSV: repo,path,commit,provider,url */
export function linksToCSV(links: GeneratedLink[]): string {
  const esc = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const rows = ["repo,path,commit,provider,url"];
  for (const l of links) {
    for (const u of l.urls) {
      rows.push([esc(l.repo), esc(l.path), esc(l.sha), esc(u.provider.name), esc(u.url)].join(","));
    }
  }
  return rows.join("\n");
}

/** Structured JSON export (lossless, re-importable). */
export function linksToJSON(links: GeneratedLink[]): string {
  return JSON.stringify(
    {
      tool: "cdn-link-studio",
      generatedAt: new Date().toISOString(),
      links: links.map((l) => ({
        source: l.repo,
        path: l.path,
        ref: l.sha,
        urls: l.urls.map((u) => ({ provider: u.provider.name, domain: u.provider.domain, url: u.url })),
      })),
    },
    null,
    2,
  );
}

/** Group links by provider for per-CDN downloads (JSON export). */
export function groupByProvider(links: GeneratedLink[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const l of links) {
    for (const u of l.urls) {
      if (!u.url) continue; // e.g. Bunny with no zone configured
      const key = u.provider.name;
      const list = map.get(key) ?? [];
      list.push(u.url);
      map.set(key, list);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// ZIP writer — STORE method (no compression), no external deps.
// ---------------------------------------------------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Minimal zip writer — STORE method (no compression), no external deps. */
function crc32(buf: Uint8Array): number {
  let table = crcTable;
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

interface ZipEntry {
  data: Uint8Array;
  crc: number;
  size: number;
  name: Uint8Array;
}

/** Shared writer: local headers + central directory + EOCD. */
function writeZip(entries: ZipEntry[]): Blob {
  // Exact: local headers (30 + name + data) + central dir (46 + name) + EOCD (22)
  const total =
    entries.reduce((a, c) => a + 30 + c.name.length + c.size, 0) +
    entries.reduce((a, c) => a + 46 + c.name.length, 0) +
    22;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let off = 0;

  const writeU16 = (v: number) => {
    view.setUint16(off, v, true);
    off += 2;
  };
  const writeU32 = (v: number) => {
    view.setUint32(off, v, true);
    off += 4;
  };

  // Local file headers + data
  const localOffsets: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    localOffsets.push(off);
    writeU32(0x04034b50);
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(0); // method: store
    writeU16(0); // mod time
    writeU16(0x21); // mod date (1980-01-01)
    writeU32(entries[i].crc);
    writeU32(entries[i].size); // compressed
    writeU32(entries[i].size); // uncompressed
    writeU16(entries[i].name.length);
    writeU16(0); // extra len
    buf.set(entries[i].name, off);
    off += entries[i].name.length;
    buf.set(entries[i].data, off);
    off += entries[i].data.length;
  }

  // Central directory
  const centralStart = off;
  for (let i = 0; i < entries.length; i++) {
    writeU32(0x02014b50);
    writeU16(20); // version made by
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(0); // method
    writeU16(0); // time
    writeU16(0x21); // date
    writeU32(entries[i].crc);
    writeU32(entries[i].size);
    writeU32(entries[i].size);
    writeU16(entries[i].name.length);
    writeU16(0); // extra
    writeU16(0); // comment
    writeU16(0); // disk
    writeU16(0); // internal attrs
    writeU32(0); // external attrs
    writeU32(localOffsets[i]);
    buf.set(entries[i].name, off);
    off += entries[i].name.length;
  }

  // End of central directory
  const cdSize = off - centralStart; // capture BEFORE writing (off advances as we write)
  writeU32(0x06054b50);
  writeU16(0);
  writeU16(0);
  writeU16(entries.length);
  writeU16(entries.length);
  writeU32(cdSize);
  writeU32(centralStart);
  writeU16(0);

  return new Blob([buf], { type: "application/zip" });
}

/**
 * Build a zip from pre-chunked text entries — the worker's export path for
 * million-link datasets. CRC is computed incrementally over the chunks so no
 * entry ever needs to exist as one giant string.
 */
export function buildZipChunks(entries: { name: string; chunks: string[] }[]): Blob {
  const enc = new TextEncoder();
  const prepared: ZipEntry[] = entries.map((entry) => {
    const parts: Uint8Array[] = [];
    let crc = 0 ^ -1;
    let size = 0;
    for (const chunk of entry.chunks) {
      const bytes = enc.encode(chunk);
      parts.push(bytes);
      for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
      }
      size += bytes.length;
    }
    return { data: concatBytes(parts), crc: (crc ^ -1) >>> 0, size, name: enc.encode(entry.name) };
  });
  return writeZip(prepared);
}

/** Build a zip file from {filename → text} entries entirely in the browser. */
export function buildZip(entries: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const prepared: ZipEntry[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const data = enc.encode(text);
    prepared.push({ data, crc: crc32(data), size: data.length, name: enc.encode(name) });
  }
  return writeZip(prepared);
}
