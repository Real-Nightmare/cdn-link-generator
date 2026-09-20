// Palo Alto Networks URL filtering — vendored from the uploaded filter-apis
// package (vendor/paloalto.js) and ported to TypeScript for the browser.
import paloBlocked from "./json/paloblocked.json";
import { fetchURL } from "../browserFetch";

const paloblocked = paloBlocked as string[];

export async function palo(targetUrl: string): Promise<[string, boolean]> {
  const encoded = encodeURIComponent(targetUrl);
  const url = `https://urlfiltering.paloaltonetworks.com/single_cr/?url=${encoded}`;

  const resp = await fetchURL(url, {
    headers: {
      Accept: "application/json,text/html,*/*",
      Referer: "https://urlfiltering.paloaltonetworks.com/",
    },
    timeoutMs: 15000,
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  let text = await resp.text();
  text = text.replace(/[\t\n\r\f\v]+/g, "");
  text = text.replace(/ {2,}/g, " ");

  const marker = `Current Category</label> <div class=" col-sm-10 col-lg-10 form-text"> `;
  const category = text.split(marker)[1].split(" <")[0].trim();
  const fixedcategory = category.replace(/<[^>]*>/g, "").trim();

  const categories = fixedcategory.split(",").map((c) => c.trim());
  const blocked = categories.some((cat) => paloblocked.includes(cat));

  // The vendor adapter returned [category, !blocked]; the registry treats the
  // second element as "blocked", so invert here to keep semantics identical.
  return [fixedcategory, !blocked];
}
