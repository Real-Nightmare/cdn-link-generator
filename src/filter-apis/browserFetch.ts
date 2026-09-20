// Browser replacement for the vendor package's fetch.js (which used undici).
// Sends a browser-like UA and enforces a timeout via AbortController.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function fetchURL(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20000, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: rest.signal || controller.signal,
      headers: { "user-agent": UA, ...(rest.headers as Record<string, string>) },
    });
  } finally {
    clearTimeout(timer);
  }
}
