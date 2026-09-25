// Boots dist-svg/cdn-link-studio.svg in headless Chromium and reports whether
// the full React app rendered inside the SVG's foreignObject — the same thing
// a browser does when the file is opened or hosted as a link.
//
// The app lives inside a srcdoc <iframe> created by the SVG's boot script, so
// every assertion evaluates INSIDE the frame document — an outer-document
// querySelector can never see into an iframe, and #id selectors don't match
// XHTML inside foreignObject without a DTD.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const svg = readFileSync("dist-svg/cdn-link-studio.svg");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

await page.route("**/boot.svg", (route) =>
  route.fulfill({
    body: svg,
    contentType: "image/svg+xml",
    headers: { "Content-Disposition": 'inline; filename="cdn-link-studio.svg"' },
  }),
);

await page.goto("http://localhost:1/boot.svg", { waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(2500);

const state = await page.evaluate(() => {
  const fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
  const frame = fo?.querySelector("iframe");
  const win = frame?.contentWindow;
  const doc = frame?.contentDocument;
  if (!win || !doc) return { booted: false, reason: "no srcdoc iframe inside foreignObject" };
  const root = doc.querySelector("#root");
  const btns = [...doc.querySelectorAll("button")].map((b) => b.textContent.trim());
  const links = [...doc.querySelectorAll("a")].map((a) => a.textContent.trim());
  let ls = null;
  try {
    win.localStorage.setItem("cdn-svg-test", "1");
    ls = win.localStorage.getItem("cdn-svg-test") === "1";
    win.localStorage.removeItem("cdn-svg-test");
  } catch {
    ls = false;
  }
  return {
    booted: true,
    rootChildren: root ? root.children.length : 0,
    hasHeader: !!doc.querySelector("header"),
    h1: doc.querySelector("h1")?.textContent ?? null,
    buttons: btns.slice(0, 12),
    links: links.slice(0, 8),
    bodyBg: getComputedStyle(doc.body).backgroundColor,
    localStorageWorks: ls,
  };
});

console.log(JSON.stringify(state, null, 2));
console.log("page errors after boot:", errors.length ? errors.slice(0, 5) : "none");

// --- phase 2: hash navigation (exercises the patched Router createURL) ------
// Clicking "Studio" pushes a hash route, which routes through
// history.createURL → new URL(path, origin) — the code that crashed on
// opaque origins before the patch.
const nav = await page.evaluate(() => {
  const fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
  const doc = fo?.querySelector("iframe")?.contentDocument;
  if (!doc) return { ok: false, reason: "frame gone" };
  const link = [...doc.querySelectorAll("a")].find((a) => a.getAttribute("href") === "#/generate");
  if (!link) return { ok: false, reason: "no Studio link" };
  link.click();
  return { ok: true };
});
let studioOk = false;
if (nav.ok) {
  await page.waitForTimeout(800);
  studioOk = await page.evaluate(() => {
    const fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
    const doc = fo?.querySelector("iframe")?.contentDocument;
    if (!doc) return false;
    const h1 = doc.querySelector("h1")?.textContent ?? "";
    return doc.querySelector("iframe")?.contentWindow.location.hash === "#/generate" && h1.length > 0;
  });
}
console.log("studio navigation:", studioOk ? "OK — Generator rendered at #/generate" : nav.reason ?? "FAILED");
console.log("page errors after nav:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
const ok = state.booted && state.rootChildren > 0 && state.hasHeader && studioOk && errors.length === 0;
process.exit(ok ? 0 : 1);
