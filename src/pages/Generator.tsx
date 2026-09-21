import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  CATEGORY_LABELS,
  CDN_PROVIDERS,
  applyPreset,
  bunnyReady,
  setBunnyZone,
  CDN_PRESETS,
} from "../lib/cdns";
import {
  GitHubRepo,
  PackageVersion,
  enablePages,
  getPagesInfo,
  listPackageVersions,
  parseRepoURL,
  verifyToken,
} from "../lib/github";
import type { DomainFilterResult } from "../filter-apis/registry";
import { FILTERS } from "../filter-apis/registry";
import {
  GenProgressPayload,
  RunSummary,
  TablePage,
  copyFromWorker,
  downloadBuffer,
  pipeline,
} from "../workers/pipeline-client";
import {
  AppSettings,
  DownloadScope,
  loadSettings,
  MAX_URL_BUDGET_CLAMP,
  MIN_URL_BUDGET,
  saveSettings,
} from "../lib/settings";
import { ProgressBar, Spinner, StatCard } from "../components/ui";

type RunState = "idle" | "running" | "done";
type Mode = "repo" | "npm";

const COMMIT_CHOICES = [0, 1, 3, 5, 10, 25, 50];

/** No progress for this long during a run → show the "still working" card.
 * Big scans (100k+ links) legitimately run for minutes; this replaces the
 * silent black screen with visible status and a stop option. */
const WATCHDOG_TIMEOUT_MS = 180_000;

/** Above this many links the browse table is never rendered — at that scale
 * even a paged table is noise; downloads/exports stay fully available. */
const BROWSE_HIDE_LIMIT = 1_000_000;

/** Rows fetched per table page from the worker. */
const PAGE_SIZE = 200;

/** Max filter-checker result cards rendered — huge runs probe hundreds of
 * sampled targets and rendering them all would freeze the panel. Blocked
 * targets are always shown first. */
const FILTER_CARDS_MAX = 120;

function parseRepoLines(text: string): { repos: GitHubRepo[]; invalid: string[] } {
  const repos: GitHubRepo[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = parseRepoURL(t);
      const key = `${r.owner}/${r.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        repos.push(r);
      }
    } catch {
      invalid.push(t);
    }
  }
  return { repos, invalid };
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

const CATEGORY_ORDER = ["jsdelivr", "proxy", "esm", "npm"] as const;

export default function Generator() {
  const initial = useMemo(loadSettings, []);
  const [mode, setMode] = useState<Mode>("repo");
  const [repoText, setRepoText] = useState(initial.lastRepos.join("\n"));
  const [npmPkg, setNpmPkg] = useState(initial.npmPkg);
  const [commitsPerSVG, setCommitsPerSVG] = useState(initial.commitsPerSVG);
  const [selectedCDNs, setSelectedCDNs] = useState<number[]>(
    initial.cdnSelection.length
      ? initial.cdnSelection.map(Number).filter((id) => CDN_PROVIDERS.some((c) => c.id === id))
      : applyPreset(CDN_PRESETS.find((p) => p.id === initial.lastPreset) ?? CDN_PRESETS[1]),
  );
  const [validate, setValidate] = useState(initial.validate);
  const [concurrency, setConcurrency] = useState(initial.concurrency);
  const [downloadScope, setDownloadScope] = useState<DownloadScope>(initial.downloadScope);
  const [bunnyZoneInput, setBunnyZoneInput] = useState(initial.bunnyZone);
  const [urlBudget, setUrlBudget] = useState(initial.urlBudget);
  const [token, setToken] = useState(initial.token);

  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<GenProgressPayload | null>(null);
  const [valProgress, setValProgress] = useState<{ done: number; total: number } | null>(null);
  // The generated dataset lives in the worker. The UI only ever sees this
  // small summary — never the link array itself.
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [filterBusy, setFilterBusy] = useState(false);
  const [filterProgress, setFilterProgress] = useState<{ done: number; total: number } | null>(null);
  const [filterResults, setFilterResults] = useState<DomainFilterResult[] | null>(null);
  const [filterSampled, setFilterSampled] = useState(false);
  const [unblockedCounts, setUnblockedCounts] = useState<Record<string, number> | null>(null);
  const [unverifiedCounts, setUnverifiedCounts] = useState<Record<string, number> | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [pkgVersions, setPkgVersions] = useState<PackageVersion[] | null>(null);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);

  const [tokenStatus, setTokenStatus] = useState<
    { kind: "ok"; login: string } | { kind: "err"; msg: string } | null
  >(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Paged link browse — rows come from the worker in PAGE_SIZE slices.
  const [linksOpen, setLinksOpen] = useState(false);
  const [tableRows, setTableRows] = useState<TablePage["rows"]>([]);
  const [tableShown, setTableShown] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  const [watchdogFired, setWatchdogFired] = useState(false);
  // Big-run notices: Gofile offload links for huge exports and the
  // validation-skipped note at extreme link counts.
  const [notice, setNotice] = useState<{ kind: "info" | "link"; text: string; url?: string } | null>(null);
  const [pages, setPages] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "off" }
    | { kind: "on"; url: string; status: string }
    | { kind: "enabling" }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  // Repo key the Pages probe last ran for — prevents refetch loops with the
  // [mode, parsed, token] deps (parseRepoLines returns a fresh array each edit).
  const withPagesRef = useRef("");

  const parsed = useMemo(() => parseRepoLines(repoText), [repoText]);
  const selectedProviders = useMemo(
    () => CDN_PROVIDERS.filter((c) => selectedCDNs.includes(c.id)),
    [selectedCDNs],
  );
  // Providers actually used for the current mode.
  const activeProviders = useMemo(
    () =>
      mode === "npm"
        ? selectedProviders.filter((c) => c.format === "npm" || c.format === "npmunpkg")
        : selectedProviders.filter((c) => c.format !== "npm" && c.format !== "npmunpkg"),
    [selectedProviders, mode],
  );
  const busy =
    runState === "running" || valProgress !== null || filterBusy || filterProgress !== null;

  const totalUrls = summary?.totalUrls ?? 0;
  const browseHidden = totalUrls > BROWSE_HIDE_LIMIT;

  const filterSummary = useMemo(() => {
    if (!filterResults) return [];
    return FILTERS.map((f) => {
      let checked = 0;
      let hits = 0;
      for (const r of filterResults) {
        const entry = r.results.find((x) => x.name === f.name);
        if (!entry || entry.error) continue;
        checked++;
        if (entry.blocked) hits++;
      }
      return { name: f.name, description: f.description, checked, hits };
    });
  }, [filterResults]);

  // Keep the CDN module's bunny zone in sync with settings + input.
  useEffect(() => {
    setBunnyZone(bunnyZoneInput);
  }, [bunnyZoneInput]);

  // Persist settings whenever they change.
  useEffect(() => {
    const preset = CDN_PRESETS.find((p) => {
      const ids = applyPreset(p);
      return ids.length === selectedCDNs.length && ids.every((id, i) => selectedCDNs[i] === id);
    });
    const settings: AppSettings = {
      token,
      commitsPerSVG,
      cdnSelection: selectedCDNs.map(String),
      concurrency,
      validate,
      lastRepos: initial.lastRepos,
      npmPkg,
      lastPreset: preset?.id ?? "custom",
      downloadScope,
      bunnyZone: bunnyZoneInput,
      urlBudget,
    };
    saveSettings(settings);
  }, [token, commitsPerSVG, selectedCDNs, concurrency, validate, npmPkg, downloadScope, bunnyZoneInput, urlBudget, initial.lastRepos]);

  // Watchdog: if no progress event fires for 3 minutes mid-run, surface a
  // "still working" card instead of a silent black screen.
  useEffect(() => {
    if (runState !== "running" && !valProgress && !filterProgress) {
      setWatchdogFired(false);
      return;
    }
    const t = setTimeout(() => setWatchdogFired(true), WATCHDOG_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [runState, progress, valProgress, filterProgress]);

  // Auto-probe Pages status whenever the repo set becomes a single repo.
  useEffect(() => {
    if (mode !== "repo" || parsed.repos.length !== 1) {
      setPages({ kind: "idle" });
      withPagesRef.current = "";
      return;
    }
    const key = `${parsed.repos[0].owner}/${parsed.repos[0].name}`;
    if (withPagesRef.current === key) return;
    withPagesRef.current = key;
    setPages({ kind: "checking" });
    let cancelled = false;
    getPagesInfo(parsed.repos[0], token.trim() || undefined)
      .then((info) => {
        if (!cancelled) setPages(info ? { kind: "on", url: info.url, status: info.status } : { kind: "off" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPages({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, parsed, token]);

  /** Enable GitHub Pages on the target repo, then re-probe for its URL. */
  async function handleEnablePages() {
    if (parsed.repos.length !== 1 || busy) return;
    setPages({ kind: "enabling" });
    const repo = parsed.repos[0];
    try {
      await enablePages(repo, token.trim() || undefined);
      const info = await getPagesInfo(repo, token.trim() || undefined);
      setPages(info ? { kind: "on", url: info.url, status: info.status } : { kind: "off" });
    } catch (err) {
      setPages({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  function applyPresetById(id: string) {
    const preset = CDN_PRESETS.find((p) => p.id === id);
    if (preset) setSelectedCDNs(applyPreset(preset));
  }

  function toggleCDN(id: number) {
    setSelectedCDNs((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b),
    );
  }

  async function loadVersions() {
    if (!npmPkg.trim() || pkgLoading) return;
    setPkgLoading(true);
    setPkgError(null);
    setPkgVersions(null);
    try {
      const versions = await listPackageVersions(npmPkg.trim());
      if (versions.length === 0) throw new Error("No published versions found");
      setPkgVersions(versions);
    } catch (err) {
      setPkgError(err instanceof Error ? err.message : String(err));
    } finally {
      setPkgLoading(false);
    }
  }

  async function handleVerifyToken() {
    if (!token.trim() || verifying) return;
    setVerifying(true);
    setTokenStatus(null);
    try {
      const login = await verifyToken(token.trim());
      setTokenStatus({ kind: "ok", login });
    } catch (err) {
      setTokenStatus({ kind: "err", msg: err instanceof Error ? err.message : "Verification failed" });
    } finally {
      setVerifying(false);
    }
  }

  /** Pull the next page of link rows from the worker and append them. */
  const loadTablePage = useCallback(
    async (offset: number) => {
      setTableLoading(true);
      try {
        const page = await pipeline.page(offset, PAGE_SIZE, validate);
        setTableRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
        setTableShown(offset + page.rows.length);
      } catch {
        // table is cosmetic — never break the page over it
      } finally {
        setTableLoading(false);
      }
    },
    [validate],
  );

  async function run() {
    const ready = mode === "repo" ? parsed.repos.length > 0 : pkgVersions !== null;
    if (!ready || activeProviders.length === 0 || busy) return;
    // Reset everything (incl. the worker's dataset state) before flipping to
    // "running" — a stale "running" from an aborted run used to black-screen
    // the results panel.
    setRunState("idle");
    setSummary(null);
    setFatalError(null);
    setValProgress(null);
    setProgress(null);
    setFilterBusy(false);
    setFilterProgress(null);
    setFilterResults(null);
    setUnblockedCounts(null);
    setFilterError(null);
    setLinksOpen(false);
    setTableRows([]);
    setTableShown(0);
    setNotice(null);
    setRunState("running");

    try {
      const res = await pipeline.generate({
        mode,
        repos: parsed.repos,
        npmPkg: npmPkg.trim(),
        versions: pkgVersions?.map((v) => v.version) ?? [],
        commitsPerSVG,
        cdnSelection: selectedCDNs.map(String),
        token: token.trim(),
        bunnyZone: bunnyReady() ? bunnyZoneInput.trim() : "",
        urlBudget,
        onProgress: setProgress,
      });
      setSummary(res);
      setRunState("done");

      // Remember repos for next time.
      if (mode === "repo") {
        const used = parsed.repos.map((r) => `${r.owner}/${r.name}`);
        const lastRepos = [...new Set([...used, ...initial.lastRepos])].slice(0, 10);
        saveSettings({
          token,
          commitsPerSVG,
          cdnSelection: selectedCDNs.map(String),
          concurrency,
          validate,
          lastRepos,
          npmPkg,
          lastPreset: "custom",
          downloadScope,
          bunnyZone: bunnyZoneInput,
          urlBudget,
        });
      }

      // Validation runs inside the worker too — the UI only sees progress.
      if (validate && res.totalUrls > 0 && !res.aborted) {
        setValProgress({ done: 0, total: res.totalUrls });
        try {
          const v = await pipeline.validate({
            concurrency,
            onProgress: (done, total) => setValProgress({ done, total }),
          });
          setSummary((s) => (s ? { ...s, validCount: v.validCount, brokenCount: v.brokenCount } : s));
          if (v.skipped) {
            setNotice({
              kind: "info",
              text: `Validation skipped — ${res.totalUrls.toLocaleString()} links exceeds the validation cap. Downloads still include every link.`,
            });
          }
        } catch {
          // best-effort — counts stay at zero
        } finally {
          setValProgress(null);
        }
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
      setRunState("idle");
    }
  }

  /** Optional Filter Checker stage — runs entirely in the worker. */
  async function runFilterCheck() {
    if (!summary || summary.totalUrls === 0 || filterBusy) return;
    setFilterError(null);
    setFilterBusy(true);
    setFilterProgress({ done: 0, total: 0 });
    try {
      const res = await pipeline.runFilters({
        concurrency,
        onProgress: (done, total) => setFilterProgress({ done, total }),
      });
      setFilterResults(res.results);
      setFilterSampled(res.sampled === true);
      setUnblockedCounts(res.unblockedCounts);
      setUnverifiedCounts(res.unverifiedCounts ?? null);
      setSummary((s) => (s ? { ...s, filterSafeCount: res.filterSafeCount } : s));
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilterBusy(false);
      setFilterProgress(null);
    }
  }

  async function handleCopy(scope: DownloadScope, label: string) {
    try {
      const res = await copyFromWorker(scope);
      setCopied(res === "copied" ? `${label} ✓` : "Copy failed");
    } catch (err) {
      setCopied(err instanceof Error ? err.message : "Copy failed");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  /** Exports ≥20MB become a Gofile link instead of a slow local download —
   * the link is auto-copied to the clipboard so it can be shared instantly. */
  async function deliverGofileLink(url: string, what: string) {
    setNotice({ kind: "link", text: `${what} is ready as a shareable Gofile.io link (also copied to your clipboard):`, url });
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // Non-secure-context fallback.
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {
        copied = false;
      }
    }
    if (!copied) setNotice({ kind: "link", text: `${what} is ready as a shareable Gofile.io link (clipboard blocked — copy it from here):`, url });
  }

  async function handleDownload(kind: "txt" | "csv" | "json" | "zip") {
    if (!summary || summary.totalUrls === 0) return;
    const suffix = downloadScope === "all" ? "" : `_${downloadScope}`;
    const name =
      mode === "npm"
        ? npmPkg.trim().replace(/[^\w.-]/g, "-")
        : parsed.repos.length === 1
          ? parsed.repos[0].name
          : "repos";
    const mime = kind === "json" ? "application/json" : kind === "csv" ? "text/csv" : kind === "zip" ? "application/zip" : "text/plain";
    try {
      const { buf, filename } = await pipeline.export({
        kind,
        scope: downloadScope,
        filename: `cdn_links_${name}${suffix}_${timestamp()}.${kind}`,
      });
      if (filename.startsWith("GOFILE:")) {
        await deliverGofileLink(filename.slice(7), "Your export");
        return;
      }
      if (!buf) throw new Error("Export returned no data");
      downloadBuffer(buf, filename, mime);
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePerFilterDownload(filterName: string) {
    try {
      const { buf, filename } = await pipeline.export({
        kind: "txt",
        scope: "all",
        filename: `unblocked_by_${filterName.replace(/[^\w.-]+/g, "-")}_${timestamp()}.txt`,
        filterName,
      });
      if (filename.startsWith("GOFILE:")) {
        await deliverGofileLink(filename.slice(7), `Unblocked-by-${filterName} export`);
        return;
      }
      if (!buf) throw new Error("Export returned no data");
      downloadBuffer(buf, filename, "text/plain");
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : String(err));
    }
  }

  const scopeLabel =
    downloadScope === "safe" ? "safe links" : downloadScope === "valid" ? "valid links" : "all links";
  const scopedCount =
    downloadScope === "safe"
      ? summary?.filterSafeCount ?? 0
      : downloadScope === "valid"
        ? summary?.validCount ?? 0
        : totalUrls;

  function handleShowMore() {
    if (!tableLoading) void loadTablePage(tableShown);
  }

  function toggleLinks() {
    const next = !linksOpen;
    setLinksOpen(next);
    if (next && tableRows.length === 0) void loadTablePage(0);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Link Studio</h1>
          <p className="mt-1 text-sm text-slate-400">
            Scan repos or npm packages, pick CDNs, generate — all heavy work runs in a background
            worker, so the page never freezes.
          </p>
        </div>
        {/* Mode switch */}
        <div className="flex rounded-lg border border-ink-500/70 bg-ink-900 p-1">
          {(["repo", "npm"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                mode === m ? "bg-accent-strong text-ink-950" : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {m === "repo" ? "GitHub repos" : "npm package"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
        {/* ---------- Config panel ---------- */}
        <div className="card space-y-5 p-5">
          {mode === "repo" ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                Repositories <span className="text-slate-500">(one per line)</span>
              </label>
              <textarea
                value={repoText}
                onChange={(e) => setRepoText(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={"owner/repo\nhttps://github.com/owner/other"}
                className="input-base resize-y font-mono"
              />
              {initial.lastRepos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {initial.lastRepos.slice(0, 4).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRepoText((t) => (t.trim() ? `${t.trim()}\n${r}` : r))}
                      className="chip font-mono text-[11px] hover:border-accent/50 hover:text-accent-soft"
                    >
                      + {r}
                    </button>
                  ))}
                </div>
              )}
              {parsed.invalid.length > 0 && (
                <p className="mt-2 text-xs text-danger">
                  Invalid: {parsed.invalid.map((i) => `"${i}"`).join(", ")}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                npm package <span className="text-slate-500">(SVGs from every version)</span>
              </label>
              <div className="flex gap-2">
                <input
                  value={npmPkg}
                  onChange={(e) => {
                    setNpmPkg(e.target.value);
                    setPkgVersions(null);
                    setPkgError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && loadVersions()}
                  spellCheck={false}
                  placeholder="bootstrap-icons"
                  className="input-base font-mono"
                  autoComplete="off"
                />
                <button
                  onClick={loadVersions}
                  disabled={!npmPkg.trim() || pkgLoading || busy}
                  className="btn-secondary shrink-0 !px-3"
                >
                  {pkgLoading ? <Spinner /> : "Load"}
                </button>
              </div>
              {pkgError && <p className="mt-2 text-xs text-danger">✗ {pkgError}</p>}
              {pkgVersions && (
                <p className="mt-2 text-xs text-accent">
                  ✓ {pkgVersions.length} versions — latest {pkgVersions[0]?.version}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              {mode === "repo" ? "Commits per SVG" : "Versions to use"}
            </label>
            <select
              value={commitsPerSVG}
              onChange={(e) => setCommitsPerSVG(Number(e.target.value))}
              className="input-base"
            >
              {COMMIT_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {c === 0
                    ? mode === "repo"
                      ? "All found commits"
                      : "All versions (up to 25)"
                    : mode === "repo"
                      ? `Latest ${c} commit${c > 1 ? "s" : ""}`
                      : `Latest ${c} version${c > 1 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </div>

          {mode === "repo" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                Link memory budget
              </label>
              <input
                type="number"
                min={MIN_URL_BUDGET}
                max={MAX_URL_BUDGET_CLAMP}
                step={100000}
                value={urlBudget}
                onChange={(e) =>
                  setUrlBudget(
                    Math.max(MIN_URL_BUDGET, Math.min(MAX_URL_BUDGET_CLAMP, Math.floor(Number(e.target.value) || 0))),
                  )
                }
                className="input-base font-mono"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Above {urlBudget.toLocaleString()} links, commit history is sampled (newest commit always kept).
                Max 50M — beyond the default, huge runs rely on streaming + Gofile offload for exports.
              </p>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                CDNs <span className="text-slate-500">({selectedProviders.length})</span>
              </label>
              <span className="font-mono text-[11px] text-slate-500">
                {activeProviders.length} active in {mode} mode
              </span>
            </div>

            {/* Presets */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CDN_PRESETS.map((p) => {
                const ids = applyPreset(p);
                const active =
                  ids.length === selectedCDNs.length && ids.every((id, i) => selectedCDNs[i] === id);
                return (
                  <button
                    key={p.id}
                    onClick={() => applyPresetById(p.id)}
                    title={p.description}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? "border-accent bg-accent/15 text-accent-soft"
                        : "border-ink-500/70 text-slate-400 hover:border-accent/50 hover:text-accent-soft"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              {CATEGORY_ORDER.map((cat) => {
                const providers = CDN_PROVIDERS.filter((c) => c.category === cat);
                const selectedCount = providers.filter((c) => selectedCDNs.includes(c.id)).length;
                return (
                  <div key={cat}>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {CATEGORY_LABELS[cat]}
                        <span className="ml-1.5 font-mono normal-case text-slate-600">
                          {selectedCount}/{providers.length}
                        </span>
                      </p>
                      <button
                        onClick={() => {
                          const ids = providers.map((c) => c.id);
                          const allOn = ids.every((id) => selectedCDNs.includes(id));
                          setSelectedCDNs((prev) =>
                            allOn
                              ? prev.filter((id) => !ids.includes(id))
                              : [...new Set([...prev, ...ids])].sort((a, b) => a - b),
                          );
                        }}
                        className="text-[11px] text-slate-500 hover:text-accent"
                      >
                        {selectedCount === providers.length ? "none" : "all"}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                      {providers.map((c) => {
                        const on = selectedCDNs.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => toggleCDN(c.id)}
                            title={c.note ?? c.name}
                            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left font-mono text-xs transition ${
                              on
                                ? "border-accent/50 bg-accent/10 text-accent-soft"
                                : "border-ink-600 bg-ink-900/60 text-slate-500 hover:border-ink-500"
                            }`}
                          >
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                                on ? "border-accent bg-accent text-ink-950" : "border-ink-500"
                              }`}
                            >
                              {on ? "✓" : ""}
                            </span>
                            <span className="truncate">{c.domain}</span>
                            {c.requires === "package" && (
                              <span className="ml-auto shrink-0 rounded bg-ink-800 px-1 py-0.5 text-[9px] uppercase text-warn">
                                npm
                              </span>
                            )}
                            {c.optional && !c.requires && (
                              <span className="ml-auto shrink-0 rounded bg-ink-800 px-1 py-0.5 text-[9px] uppercase text-slate-500">
                                opt
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200">Validate links</label>
            <button
              onClick={() => setValidate((v) => !v)}
              role="switch"
              aria-checked={validate}
              className={`relative h-6 w-11 rounded-full transition ${
                validate ? "bg-accent-strong" : "bg-ink-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  validate ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {validate && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                Validation network slots: <span className="font-mono text-accent">{concurrency}</span>
              </label>
              <input
                type="range"
                min={1}
                max={512}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full accent-accent-strong"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                All {totalUrls || "—"} links enter validation at once; this caps concurrent requests.
                Validation runs in the background worker.
              </p>
            </div>
          )}

          {/* Download scope — what copies and exports include. */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              Downloads &amp; copies include
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: "all", label: "All", hint: "Every generated link" },
                  { id: "valid", label: "Valid", hint: "Only links that passed validation" },
                  { id: "safe", label: "Safe", hint: "Only links no filter flags (needs Filter Checker)" },
                ] as { id: DownloadScope; label: string; hint: string }[]
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setDownloadScope(s.id)}
                  title={s.hint}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                    downloadScope === s.id
                      ? "border-accent/60 bg-accent/15 text-accent-soft"
                      : "border-ink-600 bg-ink-900/60 text-slate-500 hover:border-ink-500"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {downloadScope === "safe" && !filterResults && (
              <p className="mt-1.5 text-[11px] text-warn">
                Run the Filter Checker first — until then there are no safe links to export.
              </p>
            )}
          </div>

          {/* Bunny CDN pull zone (used when the Bunny provider is selected) */}
          {selectedProviders.some((c) => c.format === "bunny") && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                Bunny pull zone <span className="text-slate-500">(your b-cdn.net subdomain)</span>
              </label>
              <div className={`flex items-center gap-1.5 rounded-md border px-2.5 input-base ${bunnyReady() ? "border-accent/40" : ""}`}>
                <input
                  value={bunnyZoneInput}
                  onChange={(e) => setBunnyZoneInput(e.target.value)}
                  placeholder="myzone"
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-sm outline-none"
                />
                <span className="shrink-0 font-mono text-xs text-slate-500">.b-cdn.net</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Create a pull zone at bunny.net with origin
                <span className="font-mono text-slate-400"> raw.githubusercontent.com</span> (URL Host header
                routing on), then enter its name here. Links: <span className="font-mono">https://zone.b-cdn.net/raw.githubusercontent.com/owner/repo/sha/path</span>
              </p>
            </div>
          )}

          {mode === "repo" && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">
                GitHub token <span className="text-slate-500">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setTokenStatus(null);
                  }}
                  placeholder="ghp_… for 5,000 req/hr"
                  className="input-base font-mono"
                  autoComplete="off"
                />
                <button
                  onClick={handleVerifyToken}
                  disabled={!token.trim() || verifying}
                  className="btn-secondary shrink-0 !px-3"
                  title="Verify token"
                >
                  {verifying ? <Spinner /> : "Verify"}
                </button>
              </div>
              {tokenStatus?.kind === "ok" && (
                <p className="mt-1.5 text-xs text-accent">✓ Valid — signed in as {tokenStatus.login}</p>
              )}
              {tokenStatus?.kind === "err" && (
                <p className="mt-1.5 text-xs text-danger">✗ {tokenStatus.msg}</p>
              )}
              {token && (
                <button
                  onClick={() => {
                    setToken("");
                    setTokenStatus(null);
                  }}
                  className="mt-1.5 text-xs text-slate-500 hover:text-danger"
                >
                  Remove saved token
                </button>
              )}
            </div>
          )}

          <button
            onClick={run}
            disabled={
              (mode === "repo" && parsed.repos.length === 0) ||
              (mode === "npm" && !pkgVersions) ||
              activeProviders.length === 0 ||
              busy
            }
            className="btn-primary w-full py-3"
          >
            {busy ? (
              <>
                <Spinner /> Working…
              </>
            ) : activeProviders.length === 0 ? (
              mode === "npm"
                ? "Select an npm CDN below"
                : "Select at least one CDN"
            ) : (
              <>⚡ Generate {activeProviders.length > 0 && `· ${activeProviders.length} CDNs`}</>
            )}
          </button>
          {busy && (
            <button
              onClick={() => pipeline.abort()}
              className="btn-secondary w-full"
            >
              Stop
            </button>
          )}
        </div>

        {/* ---------- Results panel ---------- */}
        <div className="space-y-5">
          {/* GitHub Pages status / one-click enable (single repo in repo mode) */}
          {mode === "repo" && parsed.repos.length === 1 && pages.kind !== "idle" && (
            <div className="card flex flex-wrap items-center gap-2 p-4 text-sm">
              {pages.kind === "checking" && (
                <>
                  <Spinner />
                  <span className="text-slate-400">
                    Checking GitHub Pages for {parsed.repos[0].owner}/{parsed.repos[0].name}…
                  </span>
                </>
              )}
              {pages.kind === "on" && (
                <>
                  <span className="text-accent">
                    ✓ GitHub Pages{pages.status !== "unknown" ? ` (${pages.status})` : ""}
                  </span>
                  <a
                    href={pages.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-accent-soft underline decoration-accent/40 hover:decoration-accent"
                  >
                    {pages.url}
                  </a>
                </>
              )}
              {pages.kind === "off" && (
                <>
                  <span className="text-warn">
                    ⚠ GitHub Pages is not enabled for {parsed.repos[0].owner}/{parsed.repos[0].name}
                  </span>
                  <button
                    onClick={handleEnablePages}
                    disabled={busy}
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                    title="Enable Pages from the repo's default branch (root) — then the Pages provider links will work"
                  >
                    Enable Pages
                  </button>
                  <span className="text-[11px] text-slate-500">needs a token with administration:write</span>
                </>
              )}
              {pages.kind === "enabling" && (
                <>
                  <Spinner />
                  <span className="text-slate-400">Enabling GitHub Pages…</span>
                </>
              )}
              {pages.kind === "error" && <span className="text-danger">✗ Pages: {pages.msg}</span>}
            </div>
          )}

          {fatalError && (
            <div className="card border-danger/40 bg-danger/5 p-5">
              <p className="font-semibold text-danger">Run failed</p>
              <p className="mt-1 text-sm text-slate-300">{fatalError}</p>
            </div>
          )}

          {progress && runState === "running" && (
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-mono text-slate-300">{progress.label}</span>
                <span className="font-mono text-xs text-slate-500">
                  {progress.current}/{progress.total || "?"}
                </span>
              </div>
              <ProgressBar value={progress.current} total={progress.total} />
            </div>
          )}

          {/* Long-run watchdog: replaces the silent black screen with status. */}
          {busy && watchdogFired && (
            <div className="card animate-pulse-soft border-warn/30 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-warn">Still working — large runs take a while</p>
                  <p className="mt-1 text-sm text-slate-400">
                    No new progress for over {Math.round(WATCHDOG_TIMEOUT_MS / 60_000)} minutes. Work runs in a
                    background worker, so the page stays interactive; very big repos can take several minutes.
                  </p>
                </div>
                <button
                  onClick={() => pipeline.abort()}
                  className="btn-secondary shrink-0 border-warn/50 px-4 text-warn hover:border-warn hover:text-warn"
                >
                  ■ Stop run
                </button>
              </div>
            </div>
          )}

          {summary && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label={mode === "npm" ? "Unique SVGs" : "SVGs found"}
                  value={mode === "npm" ? summary.uniqueSvgCount : summary.repos.reduce((a, r) => a + r.svgCount, 0)}
                />
                <StatCard label="Links built" value={totalUrls} />
                {validate ? (
                  <>
                    <StatCard
                      label="Validated OK"
                      value={
                        valProgress
                          ? `${valProgress.done}/${valProgress.total}`
                          : `${summary.validCount}${totalUrls > 0 ? ` (${Math.round((summary.validCount / totalUrls) * 100)}%)` : ""}`
                      }
                      tone="good"
                    />
                    <StatCard
                      label="Unreachable"
                      value={valProgress ? "…" : summary.brokenCount}
                      tone={valProgress ? "default" : "warn"}
                    />
                  </>
                ) : (
                  <StatCard label="Validation" value="off" />
                )}
                <StatCard label="Providers" value={activeProviders.length} />
              </div>

              {/* Repo status */}
              <div className="card p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {mode === "npm" ? "Versions" : "Repos"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {summary.repos.map((r) => (
                    <span
                      key={r.repo}
                      className={`chip font-mono ${
                        r.error
                          ? "border-danger/40 text-danger"
                          : r.svgCount > 0
                            ? "border-accent/40 text-accent-soft"
                            : "text-slate-400"
                      }`}
                    >
                      {r.error ? `✗ ${r.repo}: ${r.error}` : `✓ ${r.repo}: ${r.svgCount} SVGs`}
                    </span>
                  ))}
                </div>
                {summary.truncated && (
                  <p className="mt-2 text-xs text-warn">
                    ⚠ GitHub truncated the tree listing — very large repos may be incomplete.
                  </p>
                )}
                {summary.sampled && (
                  <p className="mt-2 text-xs text-warn">
                    ⚠ Huge repo: commit history was sampled so the run fits in memory — links still cover every SVG,
                    spread across the history. Lower "Commits per SVG" or raise the link memory budget for full depth.
                  </p>
                )}
                {notice?.kind === "info" && (
                  <p className="mt-2 text-xs text-accent">ℹ {notice.text}</p>
                )}
                {notice?.kind === "link" && (
                  <p className="mt-2 text-xs text-accent">
                    ☁ {notice.text}{" "}
                    <a href={notice.url} target="_blank" rel="noreferrer" className="underline hover:text-accent-soft">
                      open download link
                    </a>
                  </p>
                )}
              </div>

              {/* Actions */}
              {totalUrls > 0 && (
                <div className="card flex flex-wrap items-center gap-2 p-4">
                  <button
                    onClick={() => handleCopy(downloadScope, `${scopeLabel} copied`)}
                    disabled={scopedCount === 0}
                    className="btn-primary !px-4 !py-2 text-xs"
                    title={
                      downloadScope === "safe"
                        ? "Links whose domain no filter blocks"
                        : downloadScope === "valid"
                          ? "Links that passed validation"
                          : "Every generated link"
                    }
                  >
                    Copy {scopeLabel} ({scopedCount})
                  </button>
                  <button
                    onClick={() => handleCopy("all", "All links copied")}
                    className="btn-secondary !px-4 !py-2 text-xs"
                  >
                    Copy all
                  </button>
                  <button
                    onClick={runFilterCheck}
                    disabled={filterBusy}
                    className="btn-secondary !px-4 !py-2 text-xs"
                    title={`Probe every link's domain against ${FILTERS.length} filter engines (Lightspeed, FortiGuard, Blocksi, Linewize, Deledao, Senso, Sophos, Barracuda + DNS resolvers)`}
                  >
                    🛡 Filter Checker ({FILTERS.length})
                  </button>
                  <button onClick={() => handleDownload("txt")} className="btn-secondary !px-4 !py-2 text-xs">
                    ⬇ .txt
                  </button>
                  <button onClick={() => handleDownload("csv")} className="btn-secondary !px-4 !py-2 text-xs">
                    ⬇ .csv
                  </button>
                  <button onClick={() => handleDownload("json")} className="btn-secondary !px-4 !py-2 text-xs">
                    ⬇ .json
                  </button>
                  <button onClick={() => handleDownload("zip")} className="btn-secondary !px-4 !py-2 text-xs">
                    ⬇ .zip <span className="text-slate-500">(per CDN)</span>
                  </button>
                  {copied && <span className="ml-auto font-mono text-xs text-accent">{copied}</span>}
                </div>
              )}

              {/* Validation progress */}
              {valProgress && (
                <div className="card p-4">
                  <div className="mb-2 flex justify-between text-xs text-slate-400">
                    <span>Validating links (background worker)…</span>
                    <span className="font-mono">
                      {valProgress.done}/{valProgress.total}
                    </span>
                  </div>
                  <ProgressBar value={valProgress.done} total={valProgress.total} />
                </div>
              )}

              {/* Filter Checker (optional stage after validation) */}
              {(filterProgress || filterError || filterResults) && (
                <div className="card p-4">
                  {filterProgress ? (
                    <>
                      <div className="mb-2 flex justify-between text-xs text-slate-400">
                        <span>Filter Checker — probing serving URLs…</span>
                        <span className="font-mono">
                          {filterProgress.done}/{filterProgress.total}
                        </span>
                      </div>
                      <ProgressBar value={filterProgress.done} total={filterProgress.total} />
                      <button
                        onClick={() => pipeline.abort()}
                        className="mt-3 text-xs text-slate-500 hover:text-danger"
                      >
                        Stop filter check
                      </button>
                    </>
                  ) : filterError ? (
                    <p className="text-xs text-danger">✗ Filter Checker failed: {filterError}</p>
                  ) : (
                    filterResults && (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Filter Checker — {filterResults.length.toLocaleString()} serving URL{filterResults.length === 1 ? "" : "s"} probed
                            {filterSampled && " (large run: paths sampled per host — host verdicts cover every link)"}
                          </p>                            <span
                              className={`chip font-mono text-[11px] ${
                                totalUrls - (summary.filterSafeCount ?? 0) > 0
                                  ? "border-warn/40 text-warn"
                                  : "border-accent/40 text-accent-soft"
                              }`}
                            >
                              {totalUrls - (summary.filterSafeCount ?? 0) > 0
                                ? `⚠ ${(totalUrls - (summary.filterSafeCount ?? 0)).toLocaleString()} links blocked at their serving URL`
                                : "✓ no blocked URLs"}
                            </span>
                          </div>
                          {unverifiedCounts && Object.values(unverifiedCounts).some((n) => n > 0) && (
                            <p className="mt-1 text-[11px] text-warn">
                              ⚠ {FILTERS.filter((f) => (unverifiedCounts[f.name] ?? 0) > 0)
                                .map((f) => `${f.name}: ${(unverifiedCounts[f.name] ?? 0).toLocaleString()} unverified (no verdict)`)
                                .join(" · ")}
                              — those links are NOT counted as unblocked.
                            </p>
                          )}
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {filterResults.slice(0, FILTER_CARDS_MAX).map((r) => (
                            <div
                              key={r.domain}
                              className={`rounded-lg border px-3 py-2 font-mono text-xs ${
                                r.blocked
                                  ? "border-danger/40 bg-danger/5 text-danger"
                                  : "border-ink-600 bg-ink-900/60 text-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate" title={r.domain}>
                                  {r.domain}
                                </span>
                                <span className="shrink-0">{r.blocked ? "BLOCKED" : "clear"}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {FILTERS.map((f) => {
                                  const entry = r.results.find((x) => x.name === f.name);
                                  return (
                                    <span
                                      key={f.name}
                                      title={`${f.name} — ${f.description}${
                                        entry?.error
                                          ? `\nerror — ${entry.error}`
                                          : entry?.blocked
                                            ? "\nverdict: blocked"
                                            : "\nverdict: not blocked"
                                      }`}
                                      className={`rounded px-1 py-0.5 text-[9px] uppercase ${
                                        entry?.error
                                          ? "bg-ink-800 text-slate-500"
                                          : entry?.blocked
                                            ? "bg-danger/20 text-danger"
                                            : "bg-accent/10 text-accent-soft"
                                      }`}
                                    >
                                      {f.short}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        {filterSummary.some((s) => s.hits > 0) && (
                          <p className="mt-3 text-[11px] text-slate-500">
                            {filterSummary
                              .filter((s) => s.hits > 0)
                              .map((s) => `${s.name}: ${s.hits}`)
                              .join(" · ")}
                          </p>
                        )}

                        {/* Per-filter unblocked downloads: pick the filter whose verdict
                            matters for your community and export exactly those links.
                            Counts are precomputed in the worker. */}
                        {unblockedCounts && Object.values(unblockedCounts).some((n) => n > 0) && (
                          <div className="mt-4 border-t border-ink-700 pt-3">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Download links unblocked by…
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {FILTERS.filter((f) => (filterSummary.find((s) => s.name === f.name)?.checked ?? 0) > 0).map(
                                (f) => {
                                  const count = unblockedCounts[f.name] ?? 0;
                                  const unverified = unverifiedCounts?.[f.name] ?? 0;
                                  return (
                                    <button
                                      key={f.name}
                                      onClick={() => handlePerFilterDownload(f.name)}
                                      className={`chip font-mono text-[11px] ${
                                        count === 0 ? "opacity-40" : "hover:border-accent/50 hover:text-accent-soft"
                                      }`}
                                      title={
                                        unverified > 0
                                          ? `${count.toLocaleString()} links verified NOT blocked by ${f.name} — ${unverified.toLocaleString()} unverified (no verdict, excluded)`
                                          : `${count} links NOT blocked by ${f.name}`
                                      }
                                    >
                                      ⬇ {f.name} ({count.toLocaleString()})
                                      {unverified > 0 && <span className="text-warn"> +{unverified.toLocaleString()} unverified</span>}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500">
                              Each button exports only the links that filter did NOT flag —
                              e.g. pick Lightspeed if that's what your school runs.
                            </p>
                          </div>
                        )}
                      </>
                    )
                  )}
                </div>
              )}

              {/* Link browser — collapsed by default, paged from the worker,
                  and hidden entirely above 1M links. */}
              {totalUrls > 0 && (
                <div className="card overflow-hidden">
                  <button
                    onClick={toggleLinks}
                    className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-ink-800/40"
                  >
                    <span>
                      Links ({totalUrls.toLocaleString()} total)
                      {browseHidden
                        ? " — list hidden at this scale, use downloads"
                        : linksOpen
                          ? ""
                          : " — click to browse"}
                    </span>
                    <span className="text-accent">{linksOpen && !browseHidden ? "▲ hide" : "▼ show"}</span>
                  </button>
                  {linksOpen && !browseHidden && (
                    <LinkTable
                      rows={tableRows}
                      shown={tableShown}
                      total={totalUrls}
                      loading={tableLoading}
                      onShowMore={handleShowMore}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {runState === "idle" && !summary && !fatalError && (
            <div className="card flex h-full min-h-[320px] flex-col items-center justify-center p-10 text-center">
              <div className="text-4xl">🔗</div>
              <p className="mt-4 font-semibold text-slate-200">Ready when you are</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                {mode === "repo" ? (
                  <>
                    Add a repository on the left — try <span className="font-mono text-accent-soft">twbs/icons</span>{" "}
                    or <span className="font-mono text-accent-soft">FortAwesome/Font-Awesome</span> — and hit
                    Generate.
                  </>
                ) : (
                  <>
                    Load a package like <span className="font-mono text-accent-soft">bootstrap-icons</span> and
                    turn every SVG in every version into unpkg + jsDelivr links.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Paged link table. Rows arrive pre-sliced from the worker (status already
 * computed there), so the main thread renders at most PAGE_SIZE rows no
 * matter how many million links exist.
 */
const LinkTable = memo(function LinkTable({
  rows,
  shown,
  total,
  loading,
  onShowMore,
}: {
  rows: TablePage["rows"];
  shown: number;
  total: number;
  loading: boolean;
  onShowMore: () => void;
}) {
  return (
    <>
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full text-left font-mono text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.url} className="border-b border-ink-800/70 last:border-0 hover:bg-ink-800/40">
                <td className="whitespace-nowrap py-2 pl-4 pr-2 align-top">
                  <span
                    className={
                      r.status === "ok"
                        ? "text-accent"
                        : r.status === "bad"
                          ? "text-danger"
                          : r.status === "blocked"
                            ? "text-warn"
                            : "text-slate-600"
                    }
                    title={r.status === "blocked" ? "Blocked by a filter at this exact URL" : undefined}
                  >
                    {r.status === "ok" ? "✓" : r.status === "bad" ? "✗" : r.status === "blocked" ? "⚠" : "·"}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 pr-2 align-top text-slate-500">
                  {r.repo}
                  <span className="mx-1 text-ink-500">/</span>
                  {r.file}
                  <span className="ml-1.5 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {r.provider}
                  </span>
                </td>
                <td className="py-2 pr-4 align-top">
                  <span className="block truncate text-slate-300" title={r.url}>
                    {r.url}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < total && (
        <button
          onClick={onShowMore}
          disabled={loading}
          className="w-full border-t border-ink-700 py-2.5 text-xs font-medium text-accent hover:bg-ink-800/50"
        >
          {loading ? "Loading…" : `Show more (${(total - shown).toLocaleString()} more URLs)`}
        </button>
      )}
    </>
  );
});
