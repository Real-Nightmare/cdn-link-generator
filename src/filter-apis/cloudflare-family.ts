// Cloudflare Family DNS (1.1.1.3) — malware + adult-content blocking.

import { jsonDohFilter } from "./shared";

export const cloudflareFamily = jsonDohFilter(
  "Cloudflare Family",
  "CF Fam",
  "Cloudflare 1.1.1.3 — malware + adult-content blocking",
  "https://family.cloudflare-dns.com/dns-query",
);
