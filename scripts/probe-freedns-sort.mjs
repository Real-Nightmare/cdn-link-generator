// Live probe of freedns.afraid.org registry sort behaviour (no login needed —
// the registry page is public). Checks:
//   • what sort=1..6 actually order by (first rows + hosts column)
//   • whether tail pages (deep page numbers) really hold the least-used domains
//   • whether &q= search still parses with the existing row regex
// Run: node scripts/probe-freedns-sort.mjs
const BASE = "https://freedns.afraid.org";

function parseRegistry(page) {
  const domains = [];
  const rowRe = /<tr class="?tr[ld]"?>[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(page)) !== null) {
    const row = m[0];
    const idm = row.match(/edit_domain_id=(\d+)[^>]*>([^<]+)</);
    if (!idm) continue;
    const text = row.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const hm = text.match(/\(([\d,]+)\s+hosts?/);
    domains.push({
      id: idm[1],
      domain: idm[2].trim(),
      hosts: hm ? parseInt(hm[1].replace(/,/g, ""), 10) : 0,
    });
  }
  let total = 0;
  const mi = page.indexOf("Showing");
  if (mi !== -1) {
    const frag = page.slice(mi, mi + 300).replace(/<[^>]+>/g, " ");
    const tm = frag.match(/Showing\s*[\d,]+\s*-\s*[\d,]+\s*of\s*([\d,]+)\s*total/);
    if (tm) total = parseInt(tm[1].replace(/,/g, ""), 10);
  }
  return { total, domains };
}

async function fetchRegistry(page, sort, q) {
  const url = `${BASE}/domain/registry/?page=${page}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0",
      accept: "text/html",
    },
    redirect: "manual",
  });
  const body = await res.text();
  const parsed = parseRegistry(body);
  return { url, status: res.status, ...parsed };
}

const sorts = [
  [1, "Domain Name"],
  [2, "Status/Age?"],
  [3, "Domain Owner"],
  [4, "Age?"],
  [5, "Popularity (current default)"],
  [6, "Domain Length/Popularity?"],
];

console.log("── sort=1..6, page 1 ─────────────────────────────");
for (const [s, label] of sorts) {
  try {
    const r = await fetchRegistry(1, s);
    const hosts = r.domains.map((d) => d.hosts);
    console.log(
      `sort=${s} (${label}): ${r.domains.length} rows, total=${r.total}\n` +
        `  first5: ${r.domains.slice(0, 5).map((d) => `${d.domain}(${d.hosts})`).join(", ")}\n` +
        `  hosts range on page: min=${Math.min(...hosts, 0)}, max=${Math.max(...hosts, 0)}`,
    );
  } catch (e) {
    console.log(`sort=${s}: ERROR ${e.message}`);
  }
}

console.log("\n── sort=5 (popularity) tail pages = least popular? ──");
const first = await fetchRegistry(1, 5);
const pages = Math.ceil(first.total / 100);
console.log(`total=${first.total}, pages=${pages}`);
for (const p of [pages - 1, pages]) {
  try {
    const r = await fetchRegistry(p, 5);
    const hosts = r.domains.map((d) => d.hosts);
    console.log(
      `page ${p}: ${r.domains.length} rows\n` +
        `  first5: ${r.domains.slice(0, 5).map((d) => `${d.domain}(${d.hosts})`).join(", ")}\n` +
        `  hosts range: min=${Math.min(...hosts, 0)}, max=${Math.max(...hosts, 0)}`,
    );
  } catch (e) {
    console.log(`page ${p}: ERROR ${e.message}`);
  }
}

console.log("\n── q= search (does it still parse rows?) ─────────");
for (const q of ["mooo", "a"]) {
  try {
    const r = await fetchRegistry(1, 5, q);
    console.log(`q=${q}: status=${r.status}, rows=${r.domains.length}, total=${r.total}, first3=${r.domains.slice(0, 3).map((d) => d.domain).join(",")}`);
  } catch (e) {
    console.log(`q=${q}: ERROR ${e.message}`);
  }
}
