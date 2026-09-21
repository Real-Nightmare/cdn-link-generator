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

/** Parse a wire-format DNS response: RCODE + A-record IPv4 answers. */
export function parseWireResponse(buf: ArrayBuffer): { rcode: number; ips: string[] } {
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const rcode = view.getUint16(2) & 0x0f;
  const qd = view.getUint16(4);
  const an = view.getUint16(6);
  const ips: string[] = [];
  let off = 12;
  for (let i = 0; i < qd && off < u8.length; i++) {
    off = skipName(u8, off) + 4; // QTYPE + QCLASS
  }
  for (let i = 0; i < an && off + 10 <= u8.length; i++) {
    off = skipName(u8, off);
    const type = view.getUint16(off);
    off += 8; // TYPE + CLASS
    off += 4; // TTL
    const rdlen = view.getUint16(off);
    off += 2;
    if (type === 1 && rdlen === 4 && off + 4 <= u8.length) {
      ips.push(`${u8[off]}.${u8[off + 1]}.${u8[off + 2]}.${u8[off + 3]}`);
    }
    off += rdlen;
  }
  return { rcode, ips };
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
      const body = await fetchWithTimeout(
        `${endpoint}?dns=${buildWireQuery(host)}`,
        "application/dns-message",
      );
      if (!body) throw new Error("no response");
      const { rcode, ips } = parseWireResponse(body);
      if (rcode === 3) return true; // NXDOMAIN
      return ips.some(isSinkholeIp);
    },
  };
}

/**
 * JSON DoH filter (Cloudflare-style). Blocked = NXDOMAIN (Status 3).
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
      if (!body) throw new Error("no response");
      const data = JSON.parse(new TextDecoder().decode(body)) as { Status?: number };
      return data.Status === 3; // NXDOMAIN
    },
  };
}
