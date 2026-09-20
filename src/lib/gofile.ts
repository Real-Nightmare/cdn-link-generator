// Gofile.io offload — for exports too large to download locally without
// killing the tab, the worker uploads the bytes and returns a share link
// instead. Anonymous uploads (no account/token); links are public.
//
// Verified against the live API (2026-09):
//   GET  https://api.gofile.io/servers → { status, data: { servers: [{name, zone}] } }
//   POST https://{server}.gofile.io/contents/uploadfile (multipart "file")
//     → { status: "ok", data: { downloadPage, code, ... } }
// Older deployments returned data.link — both shapes are accepted.

const API_BASE = "https://api.gofile.io";
/** Fallback host used when the server list itself is unreachable. */
const FALLBACK_SERVER = "store1";

/** Exports at/above this size upload to Gofile.io instead of crashing the tab
 * with one giant in-memory copy. */
let GOFILE_OFFLOAD_BYTES = 100 * 1024 * 1024;

/** Test-only hook — lets functional tests exercise the offload path without
 * building a 100 MB+ dataset. Production code never calls this. */
export function _setOffloadThresholdForTests(bytes: number): void {
  GOFILE_OFFLOAD_BYTES = bytes;
}

export interface GofileUpload {
  /** Public share link (downloadPage). */
  url: string;
  /** Short code part of the link, when the API returns one. */
  code?: string;
}

interface GofileServerResp {
  status?: string;
  data?: { servers?: { name: string; zone?: string }[] };
}

interface GofileUploadResp {
  status?: string;
  data?: { downloadPage?: string; link?: string; code?: string };
}

/** Total size of a chunk list without joining it. */
export function chunkSize(chunks: string[]): number {
  let n = 0;
  for (const c of chunks) n += c.length;
  return n;
}

/** Pick an upload server. Throws with a readable message on failure. */
async function pickServer(): Promise<string> {
  try {
    const resp = await fetch(`${API_BASE}/servers`, { method: "GET" });
    if (!resp.ok) throw new Error(`servers HTTP ${resp.status}`);
    const body = (await resp.json()) as GofileServerResp;
    const name = body.data?.servers?.[0]?.name;
    if (body.status !== "ok" || !name) throw new Error("no server in response");
    return name;
  } catch (err) {
    // Server list can fail transiently — try the fallback rather than dying.
    console.warn(`gofile: server list failed (${err instanceof Error ? err.message : err}), using fallback`);
    return FALLBACK_SERVER;
  }
}

/**
 * Upload a Blob (or bytes) and resolve to a public download link.
 * Accepts a Blob built from many chunks so callers never need to materialize
 * one giant string/bytes copy. `onProgress` reports bytes sent / total.
 * XHR is used (not fetch) because it's the only upload-progress source —
 * and it works inside workers.
 */
export async function uploadToGofile(
  data: Blob | Uint8Array,
  filename: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<GofileUpload> {
  const server = await pickServer();
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const form = new FormData();
  form.append("file", blob, filename);

  const text: string = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://${server}.gofile.io/contents/uploadfile`);
    xhr.responseType = "text";
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      };
    }
    xhr.onload = () => resolve(String(xhr.responseText ?? ""));
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.ontimeout = () => reject(new Error("upload timed out"));
    xhr.timeout = 10 * 60 * 1000; // huge files get 10 minutes
    xhr.send(form);
  });

  let body: GofileUploadResp | null = null;
  try {
    body = JSON.parse(text) as GofileUploadResp;
  } catch {
    /* non-JSON error page */
  }

  if (body?.status === "ok" && body.data) {
    const url = body.data.downloadPage ?? body.data.link;
    if (url) return { url, code: body.data.code };
  }
  const detail = body?.status ?? "non-JSON response";
  throw new Error(`Gofile upload rejected (${detail})`);
}

/**
 * Offload decision for an export: returns true when the chunk-list size is
 * at/over the offload threshold. Checking the chunk list (before joining)
 * avoids ever materializing the payload twice.
 */
export function shouldOffloadToGofile(chunks: string[] | null, byteLength: number): boolean {
  if (chunks) return chunkSize(chunks) >= GOFILE_OFFLOAD_BYTES;
  return byteLength >= GOFILE_OFFLOAD_BYTES;
}

/** Offload threshold in bytes — exports at/above this go to Gofile. */
export const GOFILE_OFFLOAD_THRESHOLD = GOFILE_OFFLOAD_BYTES;
