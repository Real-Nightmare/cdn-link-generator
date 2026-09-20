// FortiGuard web-filter lookup — vendored from the uploaded filter-apis package
// (vendor/fortiguard.js) and ported to TypeScript for the browser.
import fortiGuardCategories from "./json/fortiguard.json";
import { fetchURL } from "../browserFetch";

interface CatInfo {
  category: string;
  blocked: boolean;
}

const cats = fortiGuardCategories as Record<string, CatInfo>;

export async function fortiguard(url: string): Promise<{ category: string; blocked: boolean }> {
  const res = await fetchURL(
    "https://wsfgd1.fortiguard.net:3400/service/wfquery" +
      "?protver=1.0" +
      "&cltkey=bossbaby" +
      "&emssn=lol" +
      "&clttype=ie" +
      "&type=cate" +
      "&catver=10" +
      "&qurl=" +
      encodeURIComponent(url),
    { timeoutMs: 15000 },
  );

  const rJson = (await res.json()) as { data?: unknown[] };

  const queryCats = rJson["data"] || [];
  const names: string[] = [];
  let blocked = false;

  for (const cat of queryCats) {
    const info = cats[String(cat)] || { category: "Unknown", blocked: true };
    names.push(info.category);
    if (!blocked) blocked = info.blocked;
  }

  return { category: names.join(", "), blocked };
}
