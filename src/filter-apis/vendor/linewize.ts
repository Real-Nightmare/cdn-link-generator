// Linewize categorization — vendored from the uploaded filter-apis package
// (vendor/linewize.js) and ported to TypeScript for the browser.
import { fetchURL } from "../browserFetch";

const blockedCategories = [
  "animeandmanga", "dynamicdns", "trackers", "celebrities", "entertainment",
  "humouranddistractions", "livestreaming", "media", "socialmediaandcommunication",
  "marijuana", "crypto", "gamestorespublishers", "videogames", "blocklist.proxies",
  "aitools", "blocklist.dating", "blocklist.piracy", "whatsmyipservices", "p2p",
  "unsafesearchengines", "porn", "extreme", "malware", "matureandexplicit",
  "gamingresources", "offensive",
];

export async function linewize(domain: string): Promise<[string, boolean]> {
  const res = await fetchURL(
    "https://mvgateway.syd-1.linewize.net/get/verdict?deviceid=PHYS-SMIC-US-0000-3190&cev=3.3.0&identity=null&requested_website=" +
      encodeURIComponent(domain),
    { timeoutMs: 8000 },
  );
  const json = (await res.json()) as {
    signatures?: { category?: string; subCategory?: string };
  };

  const clean = (s?: string) =>
    s?.replaceAll("sphirewall.application.", "").replaceAll("sphirewall.category.", "");

  let subCategory = clean(json.signatures?.subCategory) ?? "Not rated";
  let category = clean(json.signatures?.category);

  let blocked = blockedCategories.includes(category ?? "") || blockedCategories.includes(subCategory);
  if (subCategory === "Not rated") {
    blocked = false;
  }
  return [subCategory, subCategory.startsWith("blocklist.") ? true : blocked];
}
