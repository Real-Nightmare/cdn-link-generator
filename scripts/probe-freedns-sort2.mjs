// Probe 2: why q= rows fail to parse (bold highlight theory) + tail-page
// ordering under sort=5 (for the least-popular reversal).
const BASE = "https://freedns.afraid.org";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0";

async function get(path) {
  const res = await fetch(BASE + path, { headers: { "user-agent": UA, accept: "text/html" } });
  return res.text();
}

console.log("── q=mooo raw rows ───────────────────────────────");
const search = await get("/domain/registry/?page=1&sort=5&q=mooo");
const rows = [...search.matchAll(/<tr class="?tr[ld]"?>[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
console.log(`rows found by <tr class=trl|trd> regex: ${rows.length}`);
console.log("first row raw (first 400 chars):");
console.log(rows[0] ? rows[0].slice(0, 400) : "(none — dumping page around first edit_domain_id)");
if (!rows.length) {
  const i = search.indexOf("edit_domain_id");
  console.log(search.slice(Math.max(0, i - 200), i + 300));
}

// improved regex: capture through </a>, strip nested tags
console.log("\n── improved parse (.*?</a> + strip tags) ─────────");
function parseRows(page) {
  const out = [];
  for (const m of page.matchAll(/<tr class="?tr[ld]"?>[\s\S]*?<\/tr>/gi)) {
    const row = m[0];
    const idm = row.match(/edit_domain_id=(\d+)[^>]*>([\s\S]*?)<\/a>/i);
    if (!idm) continue;
    const name = idm[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
    if (!name) continue;
    const text = row.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const hm = text.match(/\(([\d,]+)\s+hosts?/);
    out.push({ domain: name, hosts: hm ? parseInt(hm[1].replace(/,/g, ""), 10) : 0 });
  }
  return out;
}
const fixed = parseRows(search);
console.log(`q=mooo parsed rows: ${fixed.length} → ${fixed.slice(0, 4).map((d) => `${d.domain}(${d.hosts})`).join(", ")}`);

console.log("\n── tail page ordering (sort=5, last page) ────────");
const p1 = await get("/domain/registry/?page=1&sort=5");
const tm = p1.replace(/<[^>]+>/g, " ").match(/of\s*([\d,]+)\s*total/);
const total = tm ? parseInt(tm[1].replace(/,/g, ""), 10) : 0;
const pages = Math.ceil(total / 100);
console.log(`total=${total} pages=${pages}`);
const tail = parseRows(await get(`/domain/registry/?page=${pages}&sort=5`));
const hosts = tail.map((d) => d.hosts);
console.log(`page ${pages}: ${tail.length} rows, first10 hosts=[${hosts.slice(0, 10)}], last10 hosts=[${hosts.slice(-10)}]`);
console.log(`first5: ${tail.slice(0, 5).map((d) => `${d.domain}(${d.hosts})`).join(", ")}`);
console.log(`last5:  ${tail.slice(-5).map((d) => `${d.domain}(${d.hosts})`).join(", ")}`);
const prev = parseRows(await get(`/domain/registry/?page=${pages - 1}&sort=5`));
console.log(`page ${pages - 1}: first5: ${prev.slice(0, 5).map((d) => `${d.domain}(${d.hosts})`).join(", ")}`);
