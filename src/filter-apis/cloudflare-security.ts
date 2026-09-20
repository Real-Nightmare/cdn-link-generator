// Cloudflare Security DNS (1.1.1.2) — blocks malware & phishing domains.

import { jsonDohFilter } from "./shared";

export const cloudflareSecurity = jsonDohFilter(
  "Cloudflare Security",
  "CF Sec",
  "Cloudflare 1.1.1.2 — blocks malware & phishing domains",
  "https://security.cloudflare-dns.com/dns-query",
);
