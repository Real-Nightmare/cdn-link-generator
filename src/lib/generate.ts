// Link generation pipeline — repo mode (scan → history → links) and
// npm package mode (versions → package files → links).
//
// Generation no longer materializes URL strings: results are emitted as a
// compact implicit LinkSet (prefix templates + path groups, see linkset.ts).
// That makes generation O(tree fetches + integer bookkeeping) and lets a
// low-end device hold 45M links in a few MB.

import { byodSlots, selectCDNs, bunnyReady } from "./cdns";
import { GitHubRepo, getCommitSHAsWithTrees, getPackageSVGs, getSVGFiles, getTreeForCommit } from "./github";
import { DEFAULT_URL_BUDGET } from "./settings";
import { LinkSet, LinkSlot, LinkSource, SlotVariant } from "./linkset";
import { BlobSpool } from "./export-builders";

export interface GenOptions {
  commitsPerSVG: number; // 0 = all fetched commits (repo mode)
  cdnSelection: string[]; // empty = all providers
  /** Max flat URLs before commit history is sampled. Defaults to the settings default. */
  urlBudget?: number;
  /** BYOD: user-supplied IPs/hosts (repo mode). Each host becomes one extra
   * serving-host slot — every asset path gains a link per host. */
  byodHosts?: string[];
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

export interface GenResult {
  repos: RepoResult[];
  /** Compact implicit dataset — URLs are derived lazily. */
  set: LinkSet;
  truncated: boolean;
  /** True when commit history was sampled (files × commits × providers would
   * have exceeded the URL budget). The summary message says so. */
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

/** Repo-mode slots: npm-only providers can't build repo links. */
function repoSlots(selection: string[], bunnyZone: string | undefined, byodHosts: string[]): LinkSlot[] {
  return selectCDNs(selection)
    .filter((p) => p.format !== "npm" && p.format !== "npmunpkg")
    .map((provider) => ({
      provider,
      variant: (provider.format === "pages" ? "pages" : "ref") as SlotVariant,
    }))
    .filter((s) => s.provider.format !== "bunny" || !!bunnyZone)
    .concat(byodSlots(byodHosts));
}

/** npm-mode slots: only npm-capable providers, one slot each. */
function npmSlots(selection: string[]): LinkSlot[] {
  return selectCDNs(selection)
    .filter((p) => p.format === "npm" || p.format === "npmunpkg")
    .map((provider) => ({ provider, variant: "ref" as SlotVariant }));
}

/** Recompute the LinkSet totals. The flat row count matches iterUrlEntries
 * exactly: every slot contributes paths × refs rows — pages-variant URLs are
 * ref-independent strings but still repeat per ref (legacy parity). */
function finalize(set: LinkSet): void {
  let total = 0;
  const paths = new Set<string>();
  for (const src of set.sources) {
    for (const g of src.groups) {
      for (const p of g.paths) paths.add(p);
      total += g.paths.length * g.refIdx.length * set.slots.length;
    }
  }
  set.totalUrls = total;
  set.uniquePaths = paths.size;
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
  const bunny = bunnyReady() ? bunnyZoneName : undefined;
  const slots = repoSlots(opts.cdnSelection, bunny, opts.byodHosts ?? []);
  const result: GenResult = {
    repos: [],
    truncated: false,
    set: { mode: "repo", slots, sources: [], bunnyZone: bunny, totalUrls: 0, uniquePaths: 0 },
  };
  const budget = opts.urlBudget ?? DEFAULT_URL_BUDGET;

  for (let i = 0; i < repos.length; i++) {
    if (shouldAbort?.()) return result;
    const repo = repos[i];
    const key = `${repo.owner}/${repo.name}`;
    onProgress({ phase: "repos", current: i + 1, total: repos.length, label: `Scanning ${key}…` });
    try {
      const { files, truncated } = await getSVGFiles(repo, token);
      if (truncated) result.truncated = true;
      result.repos.push({ repo: key, svgCount: files.length });
      if (files.length === 0 || slots.length === 0) continue;

      // Phase 2: fetch commits WITH their tree SHAs — commits that share a
      // tree (the common case for seeded repos) need only one tree fetch.
      onProgress({
        phase: "commits",
        current: i + 1,
        total: repos.length,
        label: `Fetching commits for ${key}…`,
      });
      const count = opts.commitsPerSVG > 0 ? opts.commitsPerSVG : files.length;
      const commits = await getCommitSHAsWithTrees(repo, count, token);
      if (commits.length === 0) {
        result.repos.push({ repo: key, error: "no commits found", svgCount: files.length });
        continue;
      }
      const { shas, sampled } = sampleCommits(
        files.length,
        commits.map((c) => c.sha),
        slots.length,
        budget,
      );
      if (sampled) result.sampled = true;
      const keep = new Set(shas);
      const kept = commits.filter((c) => keep.has(c.sha));

      // Phase 3: fetch each unique tree once (bounded parallel), grouping
      // commits by identical tree. Memory = paths × unique trees, tiny.
      onProgress({
        phase: "links",
        current: i + 1,
        total: repos.length,
        label: `Generating links for ${key}…`,
      });
      const byTree = new Map<string, string[]>(); // treeSha → commit shas (order preserved)
      for (const c of kept) {
        const list = byTree.get(c.treeSha);
        if (list) list.push(c.sha);
        else byTree.set(c.treeSha, [c.sha]);
      }
      const treeKeys = [...byTree.keys()];
      const treePaths = new Map<string, string[]>();
      const TREES_IN_FLIGHT = 6;
      let treeDone = 0;
      for (let start = 0; start < treeKeys.length; start += TREES_IN_FLIGHT) {
        if (shouldAbort?.()) return result;
        const batch = treeKeys.slice(start, start + TREES_IN_FLIGHT);
        await Promise.all(
          batch.map(async (treeSha) => {
            try {
              const paths = await getTreeForCommit(repo, treeSha, token);
              const sorted = [...paths].sort();
              if (sorted.length > 0) treePaths.set(treeSha, sorted);
            } catch {
              // unreachable tree — its commits are skipped
            }
          }),
        );
        treeDone += batch.length;
        onProgress({
          phase: "links",
          current: Math.min(treeDone, treeKeys.length),
          total: treeKeys.length,
          label: `${key}: tree ${Math.min(treeDone, treeKeys.length)}/${treeKeys.length} — building links…`,
        });
      }

      // Assemble the source: groups in first-seen tree order, refs newest-first.
      const src: LinkSource = { key, owner: repo.owner, name: repo.name, refs: [], groups: [] };
      const refIdx = new Map<string, number>();
      for (const c of kept) {
        const idx = src.refs.length;
        src.refs.push(c.sha);
        refIdx.set(c.sha, idx);
      }
      for (const [treeSha, commitShas] of byTree) {
        const paths = treePaths.get(treeSha);
        if (!paths) continue;
        src.groups.push({ paths, refIdx: commitShas.map((s) => refIdx.get(s)!).filter((v) => v !== undefined) });
      }
      if (src.groups.length > 0) {
        result.set.sources.push(src);
        finalize(result.set);
      }
    } catch (err) {
      result.repos.push({
        repo: key,
        error: err instanceof Error ? err.message : String(err),
        svgCount: 0,
      });
    }
  }

  finalize(result.set);
  if (result.set.totalUrls === 0 && result.repos.every((r) => !r.error)) {
    throw new Error("No SVG files found in any of the repositories");
  }
  onProgress({ phase: "done", current: 1, total: 1, label: "Complete" });
  return result;
}

/**
 * npm package mode: every SVG inside the package's files, replicated across
 * the selected versions and every npm-capable provider. One source per
 * version keeps each version's file list independent.
 */
export async function generatePackageLinks(
  pkg: string,
  versions: string[],
  opts: GenOptions,
  onProgress: (p: GenProgress) => void,
  shouldAbort?: () => boolean,
): Promise<GenResult> {
  const slots = npmSlots(opts.cdnSelection);
  const result: GenResult = {
    repos: [],
    truncated: false,
    set: { mode: "npm", slots, sources: [], totalUrls: 0, uniquePaths: 0 },
  };
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
      if (files.length === 0 || slots.length === 0) continue;

      onProgress({
        phase: "links",
        current: v + 1,
        total: versionsToUse.length,
        label: `Generating links for ${pkg}@${version}…`,
      });
      result.set.sources.push({
        key: `${pkg}@${version}`,
        owner: pkg,
        name: "",
        refs: [version],
        groups: [{ paths: files.sort(), refIdx: [0] }],
      });
      finalize(result.set);
    } catch (err) {
      result.repos.push({
        repo: `${pkg}@${version}`,
        error: err instanceof Error ? err.message : String(err),
        svgCount: 0,
      });
    }
  }

  finalize(result.set);
  if (result.set.totalUrls === 0 && result.repos.every((r) => !r.error)) {
    throw new Error(`No SVG files found in ${pkg} (any version)`);
  }
  onProgress({ phase: "done", current: 1, total: 1, label: "Complete" });
  return result;
}

// ---------------------------------------------------------------------------
// ZIP writer — STORE method (no compression), streaming and memory-flat.
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

function crcBytes(crc: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return crc;
}

export interface ZipLazyEntry {
  name: string;
  /** Supplies the entry's parts ON DEMAND. Only one entry's chunks exist in
   * memory at a time — the builder CRCs + spools an entry to a Blob before
   * the next entry is built, so a 5-entry ZIP of 45M links never holds more
   * than one dataset copy. */
  parts?: () => Promise<(string | Uint8Array)[]>;
  /** Streaming alternative to `parts`: the builder passes an `add` callback
   * and the entry pushes each part as it's produced. Every part is CRC'd and
   * spooled into the entry's payload Blob IMMEDIATELY, so even ONE entry
   * (e.g. the combined 45M-link .txt) never holds its full string set in
   * heap — peak memory is one batch, not one entry. Preferred over `parts`. */
  add?: (sink: (part: string | Uint8Array) => void) => Promise<void>;
}

/**
 * Streaming STORE zip. Each entry's parts are materialized once (strings
 * encoded transiently for CRC/size, the same bytes handed to the payload),
 * spooled into a per-entry Blob, and released before the next entry loads.
 * The returned Blob references the spooled payloads — in browsers they are
 * disk-backed, so peak heap stays at ONE entry's chunks.
 */
export async function buildZipLazy(entries: ZipLazyEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  // DOM lib types Blob bytes as ArrayBufferView<ArrayBuffer>; TextEncoder's
  // Uint8Array is ArrayBufferLike at the type level but always a plain
  // ArrayBuffer at runtime — one boundary cast keeps the flow honest.
  const asPart = (x: unknown): BlobPart => x as BlobPart;

  interface Prep {
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    payload: Blob;
  }
  const prepared: Prep[] = [];
  for (const entry of entries) {
    let crc = 0 ^ -1;
    let size = 0;
    const spool = new BlobSpool();
    const sink = (part: string | Uint8Array): void => {
      const bytes = typeof part === "string" ? enc.encode(part) : part;
      crc = crcBytes(crc, bytes);
      size += bytes.length;
      spool.addBytes(bytes);
    };
    if (entry.add) {
      // Streaming entry: every part is CRC'd + spooled the moment it arrives,
      // so even a single 45M-link entry never holds its strings in heap —
      // peak memory is one batch, not one entry.
      await entry.add(sink);
    } else if (entry.parts) {
      const parts = await entry.parts();
      for (const part of parts) sink(part);
      parts.length = 0; // release the chunk list; the spooled Blob owns the bytes
    } else {
      throw new Error(`ZIP entry "${entry.name}" defines neither add nor parts`);
    }
    prepared.push({
      nameBytes: enc.encode(entry.name),
      crc: (crc ^ -1) >>> 0,
      size,
      payload: spool.finish(),
    });
  }

  // Exact layout sizes — no buffer is ever allocated for the payload.
  const localHeaderSize = (nameLen: number) => 30 + nameLen;
  const centralSize = (nameLen: number) => 46 + nameLen;
  let centralStart = 0;
  for (const p of prepared) centralStart += localHeaderSize(p.nameBytes.length) + p.size;
  let cdSize = 0;
  for (const p of prepared) cdSize += centralSize(p.nameBytes.length);

  const header = (p: Prep, offset: number, central: boolean): Uint8Array<ArrayBuffer> => {
    const buf = new ArrayBuffer(central ? 46 : 30);
    const view = new DataView(buf);
    const u16 = (o: number, v: number) => view.setUint16(o, v, true);
    const u32 = (o: number, v: number) => view.setUint32(o, v, true);
    if (!central) {
      u32(0, 0x04034b50);
      u16(4, 20);
      u16(6, 0);
      u16(8, 0); // store
      u16(10, 0);
      u16(12, 0x21);
      u32(14, p.crc);
      u32(18, p.size);
      u32(22, p.size);
      u16(26, p.nameBytes.length);
      u16(28, 0);
    } else {
      u32(0, 0x02014b50);
      u16(4, 20);
      u16(6, 20);
      u16(8, 0);
      u16(10, 0);
      u16(12, 0);
      u16(14, 0x21);
      u32(16, p.crc);
      u32(20, p.size);
      u32(24, p.size);
      u16(28, p.nameBytes.length);
      u16(30, 0);
      u16(32, 0);
      u16(34, 0);
      u16(36, 0);
      u32(38, 0);
      u32(42, offset);
    }
    return new Uint8Array(buf);
  };

  const blobParts: BlobPart[] = [];
  const offsets: number[] = [];
  let off = 0;
  for (const p of prepared) {
    offsets.push(off);
    blobParts.push(header(p, 0, false), asPart(p.nameBytes), p.payload);
    off += localHeaderSize(p.nameBytes.length) + p.size;
  }
  const centralStartActual = off;
  for (let i = 0; i < prepared.length; i++) {
    blobParts.push(header(prepared[i], offsets[i], true), asPart(prepared[i].nameBytes));
    off += centralSize(prepared[i].nameBytes.length);
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, prepared.length, true);
  eocd.setUint16(10, prepared.length, true);
  eocd.setUint32(12, off - centralStartActual, true);
  eocd.setUint32(16, centralStartActual, true);
  eocd.setUint16(20, 0, true);
  blobParts.push(new Uint8Array(eocd.buffer));

  return new Blob(blobParts, { type: "application/zip" });
}
