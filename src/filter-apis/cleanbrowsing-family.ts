// CleanBrowsing Family filter — malware + adult content + VPN/proxy mix.

import { wireDohFilter } from "./shared";

export const cleanbrowsingFamily = wireDohFilter(
  "CleanBrowsing Family",
  "CB Fam",
  "CleanBrowsing family filter — malware + adult content + VPN/proxy mix",
  "https://doh.cleanbrowsing.org/doh/family-filter/",
);
