// Shared types + a DomainFilterResult interface for the batch runner.
// FilterResult/FilterDef live here too so every filter module shares one shape.

export interface FilterResult {
  name: string;
  blocked: boolean;
  error?: string;
}

export interface FilterDef {
  name: string;
  /** Short label for compact UI badges. */
  short: string;
  description: string;
  /** How the filter's endpoint is reached: direct fetch, server proxy, or WebSocket. */
  kind: "native" | "server" | "socket";
  /**
   * Resolve the URL's hostname and report whether this filter blocks it.
   * May return a plain boolean or `{ blocked, category? }` — both are accepted
   * so filter modules can be written in either style (the registry normalizes).
   */
  run: (url: string) => Promise<boolean | { blocked: boolean; category?: string }>;
}

/** Results for one probed target (host, or host+path serving URL) across
 * every filter. */
export interface DomainFilterResult {
  /** The exact target string probed: a bare host ("cdn.jsdelivr.net") for
   * host-only engines, or host + path ("cdn.jsdelivr.net/gh/twbs/icons") for
   * path-aware engines. */
  domain: string;
  results: FilterResult[];
  /** True when at least one responding filter blocks this target (errors don't count).
   * Per-filter verdicts remain available in `results` for per-filter exports. */
  blocked: boolean;
}
