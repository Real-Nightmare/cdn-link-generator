// Chunked export builders for the pipeline worker.
//
// Every builder consumes a lazy Iterable and emits bounded chunks via
// onChunk, so a 1M+ link export never materializes as one giant array or
// string. The worker assembles chunks into a Blob and transfers it back.

/** Yield to the event loop so progress messages stay responsive mid-export. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const esc = (s: string) => `"${s.replaceAll('"', '""')}"`;

export interface ExportRow {
  source: string;
  path: string;
  commit: string;
  provider: string;
  domain: string;
  url: string;
}

/** CSV in chunks: header first, then one callback batch per 20k rows. */
export async function buildCsvChunks(rows: Iterable<ExportRow>, onChunk: (text: string) => void): Promise<void> {
  onChunk("repo,path,commit,provider,url\n");
  const BATCH = 20_000;
  let batch: string[] = [];
  for (const r of rows) {
    batch.push([esc(r.source), esc(r.path), esc(r.commit), esc(r.provider), esc(r.url)].join(","));
    if (batch.length >= BATCH) {
      onChunk(batch.join("\n") + "\n");
      batch = [];
      await tick();
    }
  }
  if (batch.length > 0) onChunk(batch.join("\n") + "\n");
}

/** Plain URL list in chunks (one batch per 50k URLs). */
export async function buildTextChunks(urls: Iterable<string>, onChunk: (text: string) => void): Promise<void> {
  const BATCH = 50_000;
  let batch: string[] = [];
  for (const url of urls) {
    batch.push(url);
    if (batch.length >= BATCH) {
      onChunk(batch.join("\n") + "\n");
      batch = [];
      await tick();
    }
  }
  if (batch.length > 0) onChunk(batch.join("\n") + "\n");
}

/** JSON export groups a link's URLs — mirrors the legacy linksToJSON shape. */
export interface JsonLink {
  source: string;
  path: string;
  ref: string;
  urls: { provider: string; domain: string; url: string }[];
}

/**
 * JSON export in chunks. Layout matches linksToJSON exactly — including
 * grouping every URL of one SVG under one link object — just streamed:
 * {"tool","generatedAt","links":[{source,path,ref,urls:[…]}]}
 */
export async function buildJsonChunks(
  links: Iterable<JsonLink>,
  generatedAt: string,
  onChunk: (text: string) => void,
): Promise<void> {
  onChunk(`{\n  "tool": "cdn-link-studio",\n  "generatedAt": ${JSON.stringify(generatedAt)},\n  "links": [\n`);
  const BATCH = 10_000;
  let batch: string[] = [];
  let first = true;
  const flush = async () => {
    if (batch.length === 0) return;
    onChunk((first ? "" : ",\n") + batch.join(",\n") + "\n");
    first = false;
    batch = [];
    await tick();
  };
  for (const l of links) {
    const urls = l.urls
      .map((u) => `{ "provider": ${JSON.stringify(u.provider)}, "domain": ${JSON.stringify(u.domain)}, "url": ${JSON.stringify(u.url)} }`)
      .join(", ");
    batch.push(
      `    {` +
        `"source": ${JSON.stringify(l.source)},` +
        `"path": ${JSON.stringify(l.path)},` +
        `"ref": ${JSON.stringify(l.ref)},` +
        `"urls": [${urls}]` +
        `}`,
    );
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  onChunk("  ]\n}\n");
}
