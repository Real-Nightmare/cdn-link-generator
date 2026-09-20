// Cisco OpenDNS FamilyShield — preconfigured adult-content blocking.

import { wireDohFilter } from "./shared";

export const opendnsFamilyShield = wireDohFilter(
  "OpenDNS FamilyShield",
  "OpenDNS",
  "Cisco OpenDNS FamilyShield — preconfigured adult-content blocking",
  "https://doh.familyshield.opendns.com/dns-query",
);
