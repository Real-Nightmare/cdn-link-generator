// Live probe (2026-09): validate parseRegistryMarkdown against r.jina.ai's
// real markdown rendering of the FreeDNS registry — the tier-3 fallback used
// when the raw-HTML public proxies are down. Mirrors src/lib/freedns.ts.
const target = (p, q) => `https://freedns.afraid.org/domain/registry/?page=${p}&sort=5${q ? `&q=${q}` : ""}`;

function decodeHtml(s) {
  // node-side stand-in for the browser textarea trick
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseRegistryMarkdown(md) {
  const links = [];
  for (const m of md.matchAll(/\[([^\]]+)\]\([^)]*edit_domain_id=(\d+)[^)]*\)/gi)) {
    links.push({ name: m[1], id: parseInt(m[2], 10), start: m.index, end: m.index + m[0].length });
  }
  const domains = [];
  for (let i = 0; i < links.length; i++) {
    const name = decodeHtml(links[i].name.replace(/[*_`]/g, "")).trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) continue;
    const stop = i + 1 < links.length ? links[i + 1].start : Math.min(md.length, links[i].end + 400);
    const text = md.slice(links[i].end, stop).replace(/\[[^\]]*\]\([^)]*\)/g, " ");
    const hm = text.match(/\(([\d,]+)\s+hosts?/);
    const sm = text.match(/\b(public|private)\b/i);
    domains.push({
      domain: name,
      id: links[i].id,
      hosts: hm ? parseInt(hm[1].replace(/,/g, ""), 10) : 0,
      status: sm ? sm[1].toLowerCase() : "",
    });
  }
  let pages = 0;
  const pm = md.match(/Page\s+\d+\s+of\s+(\d+)/i);
  if (pm) pages = parseInt(pm[1], 10);
  let total = 0;
  const tm = md.match(/Showing\s*[\d,]+\s*-\s*[\d,]+\s*of\s*([\d,]+)\s*total/i);
  if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10);
  if (!total && pages) total = pages * 100;
  if (!pages && total) pages = Math.max(1, Math.ceil(total / 100));
  return { total, pages: pages || 1, domains };
}

async function jinaMd(p, q) {
  const res = await fetch(`https://r.jina.ai/${encodeURIComponent(target(p, q))}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  return res.text();
}

for (const [p, q, label] of [
  [1, "", "page 1 (most popular)"],
  [209, "", "tail page 209 (least popular)"],
  [1, "mooo", "search q=mooo"],
]) {
  const md = await jinaMd(p, q);
  const r = parseRegistryMarkdown(md);
  const hosts = r.domains.map((d) => d.hosts);
  console.log(
    `${label}: HTTP ok, rows=${r.domains.length}, pages=${r.pages}, total=${r.total}`,
    `\n  first5: ${r.domains.slice(0, 5).map((d) => `${d.domain}(${d.hosts},${d.status || "?"})`).join(", ")}`,
    `\n  hosts min/max: ${hosts.length ? Math.min(...hosts) : "-"}/${hosts.length ? Math.max(...hosts) : "-"}`,
  );
  const bad = r.domains.filter((d) => !d.domain || d.domain.includes(" ") || d.hosts === 0);
  if (bad.length) console.log(`  ⚠ suspicious rows: ${bad.slice(0, 3).map((d) => d.domain).join(", ")}`);
}
console.log("PROBE_DONE");
