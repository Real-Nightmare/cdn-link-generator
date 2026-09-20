// CleanBrowsing Security filter — malware, phishing & unwanted software.

import { wireDohFilter } from "./shared";

export const cleanbrowsingSecurity = wireDohFilter(
  "CleanBrowsing Security",
  "CB Sec",
  "CleanBrowsing security filter — malware, phishing & unwanted software",
  "https://doh.cleanbrowsing.org/doh/security-filter/",
);
