// Blocksi web-rating + AI-classifier lookups — vendored from the uploaded
// filter-apis package (vendor/blocksi.js) and ported to TypeScript.
import blocksiJson from "./json/blocksi.json";
import { fetchURL } from "../browserFetch";

interface BlocksiCat {
  name: string;
  blocked: boolean;
}

interface BlocksiDb {
  web: Record<string, BlocksiCat & { cat: string }>;
  ai: Record<string, BlocksiCat>;
}

const db = blocksiJson as unknown as BlocksiDb;

export async function blocksiAI(
  domain: string,
): Promise<[string, boolean]> {
  const res = await fetchURL("https://api.blocksi.net/url-classifier-llm/predict_url", {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: "Basic QXp6YXo6QmxvY2tzaUthcmlt",
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: domain }),
    timeoutMs: 8000,
  });
  const json = (await res.json()) as {
    document?: { predicted_specific_category: string };
    predicted_specific_category?: string;
  };

  let category: string | null;
  if ("document" in json) {
    category = json.document!.predicted_specific_category;
  } else {
    category = json.predicted_specific_category ?? null;
  }

  let shouldBeBlocked = true;
  for (const key in db.ai) {
    if (!Object.prototype.hasOwnProperty.call(db.ai, key)) continue;
    const entry = db.ai[key];
    if (entry.name === category && entry.blocked === false) {
      shouldBeBlocked = false;
      break;
    }
  }

  return [category === "Specific Category" || category === null ? "Unknown" : category, shouldBeBlocked];
}

export async function blocksiStandard(
  domain: string,
): Promise<[string, boolean]> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];
  const res = await fetchURL("https://service1.blocksi.net/getRating.json?url=" + cleanDomain, {
    timeoutMs: 8000,
  });
  const html = await res.text();
  const json = JSON.parse(html) as { Category?: number | string };
  const categoryCode = String(json.Category);
  const category = db.web[categoryCode];
  if (!category) return ["Unknown", true];
  return [category.cat + ": " + category.name, category.blocked];
}
