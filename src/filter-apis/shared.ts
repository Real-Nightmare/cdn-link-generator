// Shared plumbing for DoH-based filter APIs. All endpoints used by the
// registry are public, CORS-enabled (access-control-allow-origin: *) resolvers.

import type { FilterDef } from "./types";

const FILTER_TIMEOUT_MS = 4000;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export async function fetchWithTimeout(url: string, accept: string): Promise<ArrayBuffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FILTER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { accept }, signal: ctrl.signal, cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Encode an A-record query for `domain` in RFC 8484 wire format (base64url). */
export function buildWireQuery(domain: string): string {
  const enc = new TextEncoder();
  const labels = domain.split(".").filter(Boolean);
  let len = 12 + 1 + 4;
  for (const l of labels) len += l.length + 1;
  const buf = new Uint8Array(len);
  const view = new DataView(buf.buffer);
  view.setUint16(2, 0x0100); // flags: recursion desired
  view.setUint16(4, 1); // QDCOUNT = 1
  let off = 12;
  for (const l of labels) {
    buf[off++] = l.length;
    buf.set(enc.encode(l), off);
    off += l.length;
  }
  buf[off++] = 0; // root label
  view.setUint16(off, 1); off += 2; // QTYPE = A
  view.setUint16(off, 1); // QCLASS = IN
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const BLOCKED_IPS = ["0.0.0.0", "127.0.0.1"];
/** Cisco OpenDNS serves block pages from 146.112.61.104–111. */
function isOpenDNSBlock(ip: string): boolean {
  return ip.startsWith("146.112.61.");
}

export function isSinkholeIp(ip: string): boolean {
  return BLOCKED_IPS.includes(ip) || isOpenDNSBlock(ip);
}

function skipName(u8: Uint8Array, off: number): number {
  for (;;) {
    const len = u8[off];
    if (len === 0) return off + 1;
    if ((len & 0xc0) === 0xc0) return off + 2; // compression pointer
    off += 1 + len;
  }
}

/** Parse a wire-format DNS response: RCODE + A-record IPv4 answers + authority count. */
export function parseWireResponse(buf: ArrayBuffer): { rcode: number; ips: string[]; nsCount: number } {
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const rcode = view.getUint16(2) & 0x0f;
  const qd = view.getUint16(4);
  const an = view.getUint16(6);
  const ns = view.getUint16(8);
  const ips: string[] = [];
  let off = 12;
  for (let i = 0; i < qd && off < u8.length; i++) {
    off = skipName(u8, off) + 4; // QTYPE + QCLASS
  }
  const walkRR = (count: number, onA: (ip: string) => void): void => {
    for (let i = 0; i < count && off + 10 <= u8.length; i++) {
      off = skipName(u8, off);
      const type = view.getUint16(off);
      off += 2; // TYPE
      off += 2; // CLASS
      off += 4; // TTL — exactly once; skipping it twice read RDATA as RDLENGTH
                // and silently dropped every A answer (OpenDNS block IPs never
                // registered, so FamilyShield reported "not blocked" for all).
      const rdlen = view.getUint16(off);
      off += 2;
      if (type === 1 && rdlen === 4 && off + 4 <= u8.length) {
        onA(`${u8[off]}.${u8[off + 1]}.${u8[off + 2]}.${u8[off + 3]}`);
      }
      off += rdlen;
    }
  };
  walkRR(an, (ip) => ips.push(ip));
  let nsCount = 0;
  walkRR(ns, () => nsCount++);
  return { rcode, ips, nsCount };
}

/**
 * One wire-format A query against `endpoint`; true = NXDOMAIN or sinkhole IP.
 * NXDOMAIN is treated as blocked in BOTH shapes: SOA-backed (healthy filter
 * verdict) and bare (this resolver's filter path under load answers a
 * header-only NXDOMAIN while allowed domains keep resolving — observed live).
 * Failing the bare shape would surface as engine errors under bursts, the
 * exact "0 everywhere" symptom. Erring toward "blocked" is the safe direction
 * for a checker whose purpose is finding links that pass a filter.
 * SERVFAIL/REFUSED still THROW: the runner retries, then fails closed.
 */
async function wireQueryBlocked(endpoint: string, host: string): Promise<boolean> {
  const body = await fetchWithTimeout(
    `${endpoint}?dns=${buildWireQuery(host)}`,
    "application/dns-message",
  );
  if (!body) throw new Error("no response");
  const { rcode, ips } = parseWireResponse(body);
  if (rcode === 3) return true; // NXDOMAIN — blocked (see note above)
  if (rcode !== 0) throw new Error(`resolver rcode ${rcode}`); // SERVFAIL/REFUSED…
  return ips.some(isSinkholeIp);
}

/**
 * RFC 8484 wire-format DoH filter (CleanBrowsing, OpenDNS…).
 * Blocked = NXDOMAIN, or an A answer pointing at a sinkhole/block-page IP.
 */
export function wireDohFilter(
  name: string,
  short: string,
  description: string,
  endpoint: string,
): FilterDef {
  return {
    name,
    short,
    description,
    kind: "native",
    run: async (url) => {
      const host = hostOf(url);
      if (!host) throw new Error("Invalid URL");
      return wireQueryBlocked(endpoint, host);
    },
  };
}

/**
 * JSON DoH filter (Cloudflare-style) with an RFC 8484 wire fallback.
 * Cloudflare block pages answer NOERROR + A 0.0.0.0 (NOT NXDOMAIN), so the
 * JSON path must inspect answer IPs too — Status===3 alone misses adult
 * content on 1.1.1.3 entirely.
 */
export function jsonDohFilter(
  name: string,
  short: string,
  description: string,
  endpoint: string,
): FilterDef {
  return {
    name,
    short,
    description,
    kind: "native",
    run: async (url) => {
      const host = hostOf(url);
      if (!host) throw new Error("Invalid URL");
      const body = await fetchWithTimeout(
        `${endpoint}?name=${encodeURIComponent(host)}&type=A`,
        "application/dns-json",
      );
      if (body) {
        try {
          const data = JSON.parse(new TextDecoder().decode(body)) as {
            Status?: number;
            Answer?: Array<{ type?: number; data?: string }>;
          };
          if (data.Status === 3) return true; // NXDOMAIN — blocked
          if (data.Status === 2 || data.Status === 5) throw new Error(`resolver status ${data.Status}`);
          const ips = (data.Answer ?? [])
            .filter((a) => a.type === 1 && typeof a.data === "string")
            .map((a) => a.data as string);
          if (data.Status === 0) return ips.some(isSinkholeIp);
          // Other RCODEs — try the wire endpoint before giving up.
        } catch (e) {
          if (e instanceof Error && /resolver status/.test(e.message)) throw e;
          /* fall through to wire format */
        }
      }
      return wireQueryBlocked(endpoint, host);
    },
  };
}
