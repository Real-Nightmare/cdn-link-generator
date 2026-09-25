// TEMPORARY diagnostic — removed after use. Answer three questions about the
// srcdoc iframe environment: (1) does state-only pushState work, (2) does
// state-only replaceState work, (3) does preventDefault stop a hash anchor's
// default navigation.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const svg = readFileSync("dist-svg/cdn-link-studio.svg");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const navs = [];
page.on("framenavigated", (f) => {
  if (f !== page.mainFrame()) navs.push(f.url().slice(0, 100));
});
await page.route("**/boot.svg", (r) => r.fulfill({ body: svg, contentType: "image/svg+xml" }));
await page.goto("http://localhost:1/boot.svg", { waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(2000);

const out = await page.evaluate(() => {
  const fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
  const frame = fo.querySelector("iframe");
  const win = frame.contentWindow;
  const res = {};

  try {
    win.history.pushState({ t: 1 }, "");
    res.pushStateNoUrl = "ok, history.state=" + JSON.stringify(win.history.state);
  } catch (e) {
    res.pushStateNoUrl = "THROWS: " + e.message.slice(0, 120);
  }
  try {
    win.history.replaceState({ t: 2 }, "");
    res.replaceStateNoUrl = "ok, history.state=" + JSON.stringify(win.history.state);
  } catch (e) {
    res.replaceStateNoUrl = "THROWS: " + e.message.slice(0, 120);
  }

  // Hash anchor + preventDefault: does the frame navigate anyway?
  const a = win.document.createElement("a");
  a.href = "#probe-target";
  a.textContent = "probe";
  win.document.body.appendChild(a);
  win.__pd = false;
  win.document.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      win.__pd = true;
    },
    true,
  );
  a.click();
  res.preventDefaultRan = win.__pd;
  return res;
});
console.log(JSON.stringify(out, null, 2));
await page.waitForTimeout(800);
console.log("frame navigations during probe:", JSON.stringify(navs));
const alive = await page.evaluate(() => {
  const fo = document.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")[0];
  const doc = fo.querySelector("iframe").contentDocument;
  return { stillApp: !!doc.querySelector("#root"), h1: doc.querySelector("h1")?.textContent ?? null };
});
console.log("after hash-anchor click:", JSON.stringify(alive));
await browser.close();
