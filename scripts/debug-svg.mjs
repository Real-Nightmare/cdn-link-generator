// Capture the real error + stack when booting the SVG in headless Chromium.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const svg = readFileSync("dist-svg/cdn-link-studio.svg");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.stack ?? String(e)));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text().slice(0, 300));
});

await page.route("**/boot.svg", (route) =>
  route.fulfill({ body: svg, contentType: "image/svg+xml" }),
);
await page.goto("http://localhost:1/boot.svg", { waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(2500);
await browser.close();
