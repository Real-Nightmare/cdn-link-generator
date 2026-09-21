// Deledao ActivePulse categorization — vendored from the uploaded filter-apis
// package (vendor/deledao.js) and ported to TypeScript for the browser.
// The slow-path text classification used jsdom in Node; browsers already have
// a DOM, so we just parse with DOMParser instead.
import deledaoJson from "./json/deledao.json";
import { fetchURL } from "../browserFetch";

interface DeledaoCat {
  category_number: number;
  name: string;
  blocked: boolean;
}

const dejsonMap = new Map<number, DeledaoCat>(
  (deledaoJson as DeledaoCat[]).map((cat) => [cat.category_number, cat]),
);

const AUTH_TOKEN = "56afc0786f82c9e6fc4d49b5e63789dd";

export async function deledao(url: string): Promise<[string, boolean]> {
  let normalizedUrl = url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    normalizedUrl = "http://" + url;
  }

  // Start both fetches in parallel (category check + page text fallback).
  const categoryPromise = fetchURL("https://cc.deledao.com/GetCategory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "1.2",
      auth: AUTH_TOKEN,
      hostlist: [url],
    }),
    timeoutMs: 8000,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const htmlPromise = fetchURL(normalizedUrl, { signal: controller.signal, timeoutMs: 8000 })
    .then((res) => res.text())
    .catch(() => null)
    .finally(() => clearTimeout(timeoutId));

  const res = await categoryPromise;
  if (!res.ok) throw new Error(`GetCategory failed: ${res.status}`);

  const data = (await res.json()) as { DomainCategoryList?: { Cats?: number[] }[] };
  const domainCats = data.DomainCategoryList ?? [];

  // Fast path: domain is categorized.
  if (domainCats.length > 0 && domainCats[0]?.Cats?.[0] !== 0) {
    const catId = domainCats[0].Cats![0];
    const cat = dejsonMap.get(catId);
    if (cat) return [cat.name, cat.blocked];
    return ["Uncategorized", true];
  }

  // Slow path: fetch the page and classify its text.
  const htmlText = await htmlPromise;
  if (!htmlText || htmlText.trim().length === 0) {
    return ["Uncategorized", true];
  }

  const dom = new DOMParser().parseFromString(htmlText, "text/html");
  const text = dom.documentElement?.textContent ?? "";

  const res2 = await fetchURL("https://tx.deledao.com/GetTextCategory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "1.2",
      auth: AUTH_TOKEN,
      url: normalizedUrl,
      textArray: [{ text, lang: "en" }],
    }),
    timeoutMs: 8000,
  });

  if (!res2.ok) throw new Error(`GetTextCategory failed: ${res2.status}`);

  const jsonn = (await res2.json()) as {
    Results: { Categories: { Id: number; Label: string; Prob?: number }[] }[];
  };
  const result = jsonn.Results[0].Categories[0];
  const cat = dejsonMap.get(result.Id);
  const blocked = cat ? cat.blocked : true;

  return [result.Label, blocked];
}
