// Packs the whole CDN Link Studio build into ONE self-contained .svg file.
//
// Why: the Freebuff hosting link is blocked, so the app needs a single file
// that can be shared as a link and run with ALL features intact.
//
// How it works:
//   1. `bun run build` produces dist/ (index.html + JS + CSS + worker chunk).
//   2. This script assembles a full HTML document string: inlined CSS, the
//      app bundle, and the worker chunk embedded as a JS string → Blob URL →
//      module Worker (the bundle's `new Worker(new URL("/assets/…",
//      import.meta.url))` is patched to use the Blob URL).
//   3. The SVG boots that HTML inside a full-viewport <iframe> created from
//      the SVG's <foreignObject>. An iframe document is a REAL HTML document —
//      required because React DOM's feature detection (createElement(...).style)
//      fails in SVG/XML documents — and it inherits the SVG page's origin, so
//      localStorage (settings, repos, tokens) persists exactly like the site.
//   4. Writes dist-svg/cdn-link-studio.svg.
//
// Everything downstream is untouched: generation, validation, the Filter
// Checker, BYOD hosts, ZIP/txt/csv/json exports, Gofile offload.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const outName = "cdn-link-studio.svg";

const read = (f) => readFileSync(join(dist, f), "utf8");

// --- locate dist assets -----------------------------------------------------
const html = read("index.html");
const cssName = /href="\/(assets\/[^"]+\.css)"/.exec(html)?.[1];
const jsName = /src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (!cssName || !jsName) throw new Error("Could not find CSS/JS entries in dist/index.html");
const css = read(cssName);
const appJs = read(jsName);

// --- self-containment sanity checks ------------------------------------------
const assetsDir = join(dist, "assets");
const allJs = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
for (const f of allJs) {
  const src = readFileSync(join(assetsDir, f), "utf8");
  if (/(^|[;\s])import\s*[\{(]|(^|[;\s])import\s+["']|from\s*["']\./.test(src)) {
    throw new Error(`${f} contains module imports — the packer expects a single-file build`);
  }
}

// --- patch the app entry's worker constructor --------------------------------
const workerUrlRe =
  /new Worker\(\s*new URL\(\s*"([^"]+)"\s*,\s*import\.meta\.url\s*\)\s*,\s*\{[^}]*\}\s*\)/;
const workerMatch = workerUrlRe.exec(appJs);
if (!workerMatch) throw new Error("Worker constructor pattern not found in app bundle");
const workerName = workerMatch[1].split("/").pop();
const workerJs = read(join("assets", workerName));

let appPatched = appJs.replace(
  workerUrlRe,
  `new Worker(WORKER_BLOB_URL,{type:"module"})`,
);
if (/import\.meta\.url/.test(appPatched)) {
  throw new Error("Unhandled import.meta.url remains in app bundle — extend the patcher");
}

// --- opaque-origin patch (Router createURL fallback) -------------------------
// The iframe boots from srcdoc, so window.location is `about:srcdoc` with an
// opaque origin (`location.origin === "null"`). React Router v6 resolves
// hrefs via new URL(path, location.origin || location.href) — with an opaque
// origin it falls back to `about:srcdoc`, and `new URL(path, "about:srcdoc")`
// throws "Invalid URL", killing the app at boot. The normal site never hits
// this. Patch the compiled fallback so opaque origins resolve against a
// synthetic https://base/ instead. The pattern is matched loosely and
// verified afterwards; if the minifier changes shape, this fails loudly
// rather than shipping a broken SVG.
const routerBaseRe =
  /function\s+(\w+)\((\w+)\)\{let\s+(\w+)=(\w+)\.location\.origin!=="null"\?\4\.location\.origin:\4\.location\.href/;
const routerMatch = routerBaseRe.exec(appPatched);
if (!routerMatch) {
  throw new Error(
    "Router createURL opaque-origin fallback not found in bundle — update routerBaseRe",
  );
}
// Capture-preserving rewrite: only the fallback expression changes; every
// minified identifier (fn, param, local, window) comes from the match itself,
// so the patch survives minifier renames across builds.
appPatched = appPatched.replace(
  routerBaseRe,
  (_m, fn, param, local, win) =>
    `function ${fn}(${param}){let ${local}=${win}.location.origin!=="null"?${win}.location.origin:"https://cdn-link-studio.svg.base/"`,
);

// --- inner HTML document (what the iframe boots) ------------------------------
const innerScript =
  `const WORKER_SOURCE=${JSON.stringify(workerJs)};` +
  `const WORKER_BLOB_URL=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:"text/javascript"}));` +
  appPatched;
if (innerScript.includes("</script")) {
  throw new Error("Inner script contains a literal </script> — escaping needed");
}

const innerHtml = `<!DOCTYPE html>
<html lang="en" style="background:#07090d">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CDN Link Studio</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>
${innerScript}
</script>
</body>
</html>`;

// The SVG boot script embeds innerHtml as a JS string. `</script` inside a
// string is safe inside CDATA, but escape it anyway for defense in depth
// (classic-script string parsing treats `<\/` identically to `</`).
const payloadLiteral = JSON.stringify(innerHtml).replaceAll("</script", "<\\/script");
const bootJs = `
(function () {
  var PAYLOAD = ${payloadLiteral};
  var NS = "http://www.w3.org/1999/xhtml";
  var fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
  if (!fo) return;
  var frame = document.createElementNS(NS, "iframe");
  frame.setAttribute("title", "CDN Link Studio");
  frame.setAttribute("allow", "clipboard-write");
  frame.style.cssText = "border:0;width:100vw;height:100vh;display:block;background:#07090d";
  fo.appendChild(frame);
  // srcdoc → real HTML document, same origin as the SVG page (localStorage works)
  frame.setAttribute("srcdoc", PAYLOAD);
})();
`;

// --- safety checks ------------------------------------------------------------
if (bootJs.includes("</script")) {
  throw new Error("Boot script contains a literal </script> — escaping needed");
}
if (bootJs.includes("]]>") || innerHtml.includes("]]>")) {
  throw new Error("Content contains CDATA terminator ]]> — escaping needed");
}

const cdataSafe = (s) => s.replace(/\]\]>/g, "]]]]><![CDATA[>");

const title = "CDN Link Studio — single-file SVG";
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice">
  <title>${title}</title>
  <desc>Full CDN Link Studio app embedded as a single self-contained SVG. Open or host this file in any modern browser and the complete app boots inside a full-page frame: generation, validation, Filter Checker, BYOD hosts, exports, Gofile offload. Settings persist via localStorage.</desc>
  <foreignObject x="0" y="0" width="100%" height="100%" requiredExtensions="http://www.w3.org/1999/xhtml">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:100vw;height:100vh;margin:0;padding:0;background:#07090d;"></div>
  </foreignObject>
  <script type="text/javascript"><![CDATA[
${cdataSafe(bootJs)}
]]><![CDATA[]]></script>
  <text x="24" y="52" fill="#34d399" font-family="monospace" font-size="18">CDN Link Studio — single-file build</text>
  <text x="24" y="80" fill="#8aa0b4" font-family="monospace" font-size="13">Open this .svg in a real browser (Chrome/Edge/Firefox) to boot the full app.</text>
</svg>
`;

mkdirSync("dist-svg", { recursive: true });
writeFileSync(join("dist-svg", outName), svg);
console.log(
  `✓ dist-svg/${outName}: ${(svg.length / 1024).toFixed(1)} KB — app ${jsName} (${(appJs.length / 1024).toFixed(0)} KB), worker ${workerName} (${(workerJs.length / 1024).toFixed(0)} KB), css ${cssName} (${(css.length / 1024).toFixed(0)} KB)`,
);
