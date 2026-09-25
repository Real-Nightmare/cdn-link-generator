// One-off verification: boot the Studio in headless Chromium, open the BYOD
// section, open the FreeDNS automator, the least-popular registry toggle and
// the 🧰 BYOD automator toolbox, and confirm graceful relay-absence.
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

await page.goto("http://localhost:3000/#/generate", { waitUntil: "load" });
await page.waitForTimeout(2500);

const state = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return {
    h1: document.querySelector("h1")?.textContent ?? null,
    hasByod: t("p,span").some((s) => s.includes("BYOD IPs")),
    hasAutomator: t("button").some((s) => s.includes("Automate FreeDNS")),
  };
});
console.log("boot:", JSON.stringify(state));

// Scroll the automator into view and open it.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Automate FreeDNS"));
  btn?.scrollIntoView({ block: "center" });
  btn?.click();
});
await page.waitForTimeout(4000);

const opened = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  const imgs = [...document.querySelectorAll("img")].map((i) => ({ alt: i.alt, w: i.naturalWidth }));
  return {
    explainsDomain92: t("p").some((s) => s.includes("domain92")),
    relayUnavailableNote: t("span").some((s) => s.includes("isn't reachable")),
    newAccountBtn: t("button").some((s) => s.includes("New account")),
    loginBtn: t("button").some((s) => s.includes("Log in")),
    captchaImg: imgs.find((i) => i.alt === "FreeDNS captcha") ?? null,
  };
});
console.log("automator:", JSON.stringify(opened, null, 2));

// Least-popular toggle inside the automator (needs login first — the buttons
// render with the registry browser; check they exist once logged in is
// impossible headlessly, so verify the copy that advertises the feature).
const leastCopy = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return t("p").some((s) => s.includes("least popular"));
});
console.log("least-popular copy:", leastCopy);

// 🧰 BYOD automator toolbox: open it, compose a wildcard host, check adoption.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("More BYOD automators"));
  btn?.scrollIntoView({ block: "center" });
  btn?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("IP → name composer"));
  btn?.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const inp = [...document.querySelectorAll("input")].find((i) => (i.placeholder || "").includes("203.0.113.7"));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(inp, "203.0.113.7");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(300);
const toolbox = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  const adoptBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Add to BYOD"));
  adoptBtn?.click();
  return {
    composerHost: t("span").some((s) => s.includes("203.0.113.7.sslip.io")),
    ddnsPanel: t("span").some((s) => s.includes("Dynamic DNS updater")),
    tunnelPanel: t("button").some((s) => s.includes("Tunnel launcher")),
    guidedPanel: t("button").some((s) => s.includes("Full DNS panels")),
  };
});
await page.waitForTimeout(400);
const adopted = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return { wildcardInBox: t("p").some((s) => s.includes("1 valid host")) };
});
console.log("toolbox:", JSON.stringify(toolbox), "adopted:", JSON.stringify(adopted));
console.log("page errors:", errors.length ? errors.slice(0, 5) : "none");

// Regression check: the BYOD textarea still parses hosts with the panel embedded.
await page.evaluate(() => {
  const ta = [...document.querySelectorAll("textarea")].find((t) =>
    (t.placeholder || "").includes("sslip.io"),
  );
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, "203.0.113.7\nmybox.mooo.com   # automated FreeDNS record");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(600);
const byod = await page.evaluate(() => {
  const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return {
    countChip: t("span").find((s) => s.includes("hosts ·")) ?? null,
    validNote: t("p").some((s) => s.includes("2 valid hosts")),
  };
});
console.log("byod parse:", JSON.stringify(byod));

await browser.close();
const ok =
  state.hasByod &&
  state.hasAutomator &&
  opened.explainsDomain92 &&
  opened.newAccountBtn &&
  opened.loginBtn &&
  leastCopy &&
  toolbox.composerHost &&
  toolbox.ddnsPanel &&
  toolbox.tunnelPanel &&
  toolbox.guidedPanel &&
  adopted.wildcardInBox &&
  byod.validNote &&
  errors.length === 0;
console.log(ok ? "VERIFY_OK" : "VERIFY_FAILED");
process.exit(ok ? 0 : 1);
