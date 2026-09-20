// Lightspeed Filter (Rocket) lookup — browser port of lightspeed.js from the
// uploaded filter-apis package. Node's `ws` client is replaced by the native
// browser WebSocket, which talks to the same filtered-agent endpoint.
//
// One shared WebSocket connection is kept open and reused for every lookup;
// responses are matched back to waiters by host.
import lightspeedCategories from "./lightspeed-categories.json";

interface CatEntry {
  CategoryNumber: number | string;
  CategoryName: string;
  Allow: string | number;
}

const CATS = lightspeedCategories as CatEntry[];
const CAT_BY_NUM = new Map<number, CatEntry>(CATS.map((c) => [Number(c.CategoryNumber), c]));

function categoryOf(num: number): { catNum: number; category: string; allow: boolean | null; blocked: boolean | null } {
  const c = CAT_BY_NUM.get(num);
  if (!c) return { catNum: num, category: `cat ${num}`, allow: null, blocked: null };
  const allow = String(c.Allow) === "1";
  return { catNum: num, category: c.CategoryName, allow, blocked: !allow };
}

const WS_URL =
  "wss://production-gc.lsfilter.com?a=0ef9b862-b74f-4e8d-8aad-be549c5f452a&customer_id=74-1082-F000&agentType=chrome_extension&agentVersion=3.777.0&userGuid=00000000-0000-0000-0000-000000000000";
const CUSTOMER_ID = "74-1082-F000";
const LOOKUP_IP = "174.85.104.135";

interface Waiter {
  resolve: (v: { category: string; blocked: boolean }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LightspeedClient {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Waiter[]>();
  private closed = false;
  private timeoutMs: number;

  constructor({ timeoutMs = 12000 }: { timeoutMs?: number } = {}) {
    this.timeoutMs = timeoutMs;
  }

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("lightspeed client closed"));
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let settled = false;
      const drop = (msg: string) => {
        this.ready = null;
        this.ws = null;
        const e = new Error(msg);
        for (const [, waiters] of this.pending)
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.reject(e);
          }
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
      const connectTimer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        drop("lightspeed connect timeout");
      }, this.timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve();
      };
      ws.onmessage = (ev) => {
        let j: { request?: { host?: string }; cat?: number };
        try {
          j = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        const host = j?.request?.host;
        if (!host || !this.pending.has(host)) return;
        const waiters = this.pending.get(host)!;
        this.pending.delete(host);
        for (const w of waiters) {
          clearTimeout(w.timer);
          w.resolve(categoryOf(j.cat ?? -1) as unknown as { category: string; blocked: boolean });
        }
      },
      ws.onerror = () => {
        clearTimeout(connectTimer);
        this.ready = null;
        // Never surface as an unhandled 'error' event — reject connect only if
        // it hasn't opened yet; otherwise drop the socket so lookups requeue.
      };
      ws.onclose = () => {
        drop("lightspeed connection closed");
      };
    });
    return this.ready;
  }

  async lookup(host: string): Promise<{ category: string; blocked: boolean }> {
    if (this.closed) throw new Error("lightspeed client closed");
    host = String(host).toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "").split("/")[0];

    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("lightspeed not connected");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.pending.get(host);
        if (waiters) {
          const filtered = waiters.filter((w) => w.timer !== timer);
          if (filtered.length === 0) this.pending.delete(host);
          else this.pending.set(host, filtered);
        }
        reject(new Error("lightspeed timeout"));
      }, this.timeoutMs);

      const waiter: Waiter = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      };

      const waiters = this.pending.get(host) ?? [];
      waiters.push(waiter);
      this.pending.set(host, waiters);
      ws.send(JSON.stringify({ action: "dy_lookup", host, ip: LOOKUP_IP, customerId: CUSTOMER_ID }));
    });
  }

  close(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.ready = null;
  }
}

let shared: LightspeedClient | null = null;
export function getSharedLightspeed(): LightspeedClient {
  if (!shared) shared = new LightspeedClient();
  return shared;
}
