// Sophos SXL4 URL lookup — vendored from the uploaded filter-apis package
// (vendor/sophos.js) and ported to TypeScript for the browser.
// Node Buffer/https usage is replaced with Uint8Array + fetch; a persistent
// per-browser machine ID lives in localStorage instead of ~/.sophos-sxl4-id.

const API_ENDPOINT = "https://4.sophosxl.net/lookup";

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

function encodeTag(fieldNum: number, wireType: number): number[] {
  return encodeVarint((fieldNum << 3) | wireType);
}

function encodeBytesField(fieldNum: number, data: Uint8Array): Uint8Array {
  return new Uint8Array([...encodeTag(fieldNum, 2), ...encodeVarint(data.length), ...data]);
}

function encodeStringField(fieldNum: number, str: string): Uint8Array {
  return encodeBytesField(fieldNum, new TextEncoder().encode(str));
}

function encodeVarintField(fieldNum: number, value: number): Uint8Array {
  return new Uint8Array([...encodeTag(fieldNum, 0), ...encodeVarint(value)]);
}

function encodeMessageField(fieldNum: number, data: Uint8Array): Uint8Array {
  return encodeBytesField(fieldNum, data);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

class ProtobufReader {
  buf: Uint8Array;
  pos = 0;
  length: number;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.length = buf.length;
  }

  readVarint(): number {
    let val = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.length) throw new Error("Unexpected end");
      const b = this.buf[this.pos++];
      val += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
      if (b < 0x80) break;
    }
    return val;
  }

  readTag(): { fieldNum: number; wireType: number } {
    const tag = this.readVarint();
    return { fieldNum: tag >> 3, wireType: tag & 0x7 };
  }

  readBytes(): Uint8Array {
    const len = this.readVarint();
    const end = this.pos + len;
    const bytes = this.buf.slice(this.pos, end);
    this.pos = end;
    return bytes;
  }

  readString(): string {
    return new TextDecoder().decode(this.readBytes());
  }

  skip(wireType: number): void {
    if (wireType === 0) {
      this.readVarint();
    } else if (wireType === 2) {
      this.pos += this.readVarint();
    } else if (wireType === 1) {
      this.pos += 8;
    } else if (wireType === 5) {
      this.pos += 4;
    }
  }
}

interface SophosCategory {
  universal_category: number;
  detailed_category: number;
  risk_level: number;
  security_category: number;
  productivity_category: number;
}

interface SophosURLResult {
  status_code: number;
  category: SophosCategory | null;
  threat_name: string;
  labs_uri_id: number;
  ttl: number;
}

function readCategory(reader: ProtobufReader, end: number): SophosCategory {
  const category: SophosCategory = {
    universal_category: 0,
    detailed_category: 0,
    risk_level: 0,
    security_category: 0,
    productivity_category: 0,
  };
  while (reader.pos < end) {
    const tag = reader.readTag();
    if (tag.fieldNum === 1) category.universal_category = reader.readVarint();
    else if (tag.fieldNum === 2) category.detailed_category = reader.readVarint();
    else if (tag.fieldNum === 3) category.risk_level = reader.readVarint();
    else if (tag.fieldNum === 4) category.security_category = reader.readVarint();
    else if (tag.fieldNum === 5) category.productivity_category = reader.readVarint();
    else reader.skip(tag.wireType);
  }
  return category;
}

function readURLResult(reader: ProtobufReader, end: number): SophosURLResult {
  const result: SophosURLResult = {
    status_code: 0,
    category: null,
    threat_name: "",
    labs_uri_id: 0,
    ttl: 0,
  };
  while (reader.pos < end) {
    const tag = reader.readTag();
    if (tag.fieldNum === 1) result.status_code = reader.readVarint();
    else if (tag.fieldNum === 2) {
      const msgEnd = reader.pos + reader.readVarint();
      result.category = readCategory(reader, msgEnd);
    } else if (tag.fieldNum === 3) result.threat_name = reader.readString();
    else if (tag.fieldNum === 4) result.labs_uri_id = reader.readVarint();
    else if (tag.fieldNum === 6) result.ttl = reader.readVarint();
    else reader.skip(tag.wireType);
  }
  return result;
}

function readLookupResponse(reader: ProtobufReader, end: number): { url_results: SophosURLResult[] } {
  const lookup = { url_results: [] as SophosURLResult[] };
  while (reader.pos < end) {
    const tag = reader.readTag();
    if (tag.fieldNum === 2) {
      const msgEnd = reader.pos + reader.readVarint();
      lookup.url_results.push(readURLResult(reader, msgEnd));
    } else {
      reader.skip(tag.wireType);
    }
  }
  return lookup;
}

function readSXL4Response(buf: Uint8Array): { id: number; lookup: { url_results: SophosURLResult[] } | null } {
  const reader = new ProtobufReader(buf);
  const response = { id: 0, lookup: null as { url_results: SophosURLResult[] } | null };

  while (reader.pos < reader.length) {
    const tag = reader.readTag();
    if (tag.fieldNum === 1) response.id = reader.readVarint();
    else if (tag.fieldNum === 3) {
      const msgEnd = reader.pos + reader.readVarint();
      response.lookup = readLookupResponse(reader, msgEnd);
    } else reader.skip(tag.wireType);
  }

  return response;
}

export interface SophosResult {
  found: boolean;
  riskLevel?: string;
  riskLevelNum?: number;
  threat?: string | null;
  productivityCategory?: string;
  productivityCategoryNum?: number;
  isThreat?: boolean;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function getOrCreateUniqueId(): string {
  const KEY = "sophos-sxl4-id";
  let uniqueId: string | null = null;
  try {
    uniqueId = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable */
  }
  if (!uniqueId || uniqueId.length !== 64) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    uniqueId = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    try {
      localStorage.setItem(KEY, uniqueId);
    } catch {
      /* non-fatal */
    }
  }
  return uniqueId;
}

export async function sophos(url: string): Promise<SophosResult> {
  const fullUrl = url.startsWith("http://") || url.startsWith("https://") ? url : "https://" + url;
  const uniqueId = getOrCreateUniqueId();

  const customerIdBytes = new TextEncoder().encode("CHROME_EXTENSION");
  const machineIdBytes = hexToBytes(uniqueId).slice(0, 16);
  const credentials = concat(
    encodeBytesField(1, customerIdBytes),
    encodeBytesField(2, machineIdBytes),
  );

  const productInfo = concat(encodeVarintField(1, 26), encodeStringField(4, "1.0.0"));

  const urlKey = encodeStringField(1, fullUrl);
  const urlQuery = encodeMessageField(1, urlKey);
  const lookup = concat(encodeVarintField(1, 2), encodeMessageField(3, urlQuery));

  const buffer = concat(
    encodeVarintField(1, 503307768),
    encodeVarintField(2, 2),
    encodeMessageField(3, credentials),
    encodeMessageField(4, productInfo),
    encodeMessageField(5, lookup),
  );

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer as unknown as BodyInit,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const responseBuffer = new Uint8Array(await res.arrayBuffer());

  const response = readSXL4Response(responseBuffer);
  const urlResponse = response.lookup?.url_results?.[0];

  if (!urlResponse || !urlResponse.category) {
    return { found: false };
  }

  const riskLevels: Record<number, string> = {
    0: "UNCLASSIFIED",
    1: "TRUSTED",
    2: "LOW",
    3: "MEDIUM",
    4: "HIGH",
  };

  const productivityCategories: Record<number, string> = {
    0: "UNCATEGORIZED",
    1: "ADVERTISEMENTS",
    2: "ALCOHOL_AND_TOBACCO",
    3: "ANONYMIZERS",
    4: "AUCTIONS_AND_CLASSIFIED_ADS",
    5: "BLOGS_AND_FORUMS",
    6: "GENERAL_BUSINESS",
    7: "BUSINESS_CLOUD_APPS",
    8: "BUSINESS_NETWORKING",
    9: "COMMAND_AND_CONTROL",
    10: "CONTENT_DELIVERY",
    11: "CONTROLLED_SUBSTANCES",
    12: "CRIMINAL_ACTIVITY",
    13: "CRL_AND_OCSP",
    14: "DOWNLOAD_FREEWARE_AND_SHAREWARE",
    15: "DYNAMIC_DNS_AND_ISP_SITES",
    16: "EDUCATIONAL_INSTITUTIONS",
    17: "ENTERTAINMENT",
    18: "EXTREME",
    19: "FASHION_AND_BEAUTY",
    20: "FINANCIAL_SERVICES",
    21: "GAMBLING",
    22: "GAMES",
    23: "GOVERNMENT",
    24: "HACKING",
    25: "HEALTH_AND_MEDICINES",
    26: "HOBBIES",
    27: "HUNTING_AND_FISHING",
    28: "IMAGE_SEARCH",
    29: "INFORMATION_TECHNOLOGY",
    30: "INTELLECTUAL_PIRACY",
    31: "INTOLERANCE_AND_HATE",
    32: "JOB_SEARCH",
    33: "KIDS_SITES",
    34: "LEGAL_HIGHS",
    35: "LIVE_AUDIO",
    36: "LIVE_VIDEO",
    37: "MARIJUANA",
    38: "MILITANCY_AND_EXTREMIST",
    39: "MILITARY",
    40: "NEWLY_REGISTERED_WEBSITES",
    41: "NEWS",
    42: "NGOS_AND_NON_PROFITS",
    43: "NUDITY",
    44: "ONLINE_CHAT",
    45: "ONLINE_SHOPPING",
    46: "PARKED_DOMAINS",
    47: "PEER_TO_PEER_AND_TORRENTS",
    48: "PERSONAL_CLOUD_APPS",
    49: "PERSONAL_NETWORK_STORAGE",
    50: "PERSONALS_AND_DATING",
    51: "PERSONAL_SITES",
    52: "PHISHING_AND_FRAUD",
    53: "PHOTO_GALLERIES",
    54: "PLAGIARISM",
    55: "POLITICAL_ORGANIZATION",
    56: "PORTAL_SITES",
    57: "PROFESSIONAL_AND_WORKERS_ORGANIZATIONS",
    58: "PRO_SUICIDE_AND_SELF_HARM",
    59: "RADIO_AND_AUDIO_HOSTING",
    60: "REAL_ESTATE",
    61: "REFERENCE",
    62: "RELIGION_AND_SPIRITUALITY",
    63: "RESTAURANTS_AND_DINING",
    64: "SEARCH_ENGINES",
    65: "SEX_EDUCATION",
    66: "SEXUALLY_EXPLICIT",
    67: "SOCIAL_NETWORKS",
    68: "SOFTWARE_UPDATES",
    69: "SPAM_URLS",
    70: "SPORTS",
    71: "STREAMING_AND_MEDIA_DOWNLOADS",
    72: "SUSPICIOUS",
    73: "TASTELESS",
    74: "TRANSLATORS",
    75: "TRAVEL",
    76: "VEHICLES",
    77: "VIDEO_SHARING",
    78: "VIOLENCE",
    79: "WEAPONS",
    80: "WEBMAIL",
  };

  return {
    found: true,
    riskLevel: riskLevels[urlResponse.category.risk_level] || "UNKNOWN",
    riskLevelNum: urlResponse.category.risk_level,
    threat: urlResponse.threat_name || null,
    productivityCategory:
      productivityCategories[urlResponse.category.productivity_category] || "UNCATEGORIZED",
    productivityCategoryNum: urlResponse.category.productivity_category,
    isThreat: !!urlResponse.threat_name,
  };
}
