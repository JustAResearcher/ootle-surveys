import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const token = (await readFile("data/admin-access.txt", "utf8")).trim();
await mkdir("design/qa", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:4183/#admin=" + token);
await page
  .getByRole("button", { name: "Create survey", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
await page
  .getByLabel("Vault password", { exact: true })
  .fill("Survey-QA-Only-2026!");
await page
  .getByRole("button", { name: "Unlock vault", exact: true })
  .last()
  .click();
await page
  .getByRole("button", { name: "Back up vault", exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "Create survey", exact: true })
  .waitFor({ state: "visible" });
await page
  .getByRole("heading", { name: "Community feedback", exact: true })
  .waitFor();
await page.screenshot({ path: "design/qa/desktop.png", fullPage: true });
const desktop = await page.evaluate(() => ({
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  height: innerHeight,
}));
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "design/qa/mobile.png", fullPage: true });
const mobile = await page.evaluate(() => ({
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
}));
await page.setViewportSize({ width: 1536, height: 1024 });
await page.getByRole("button", { name: "Responses", exact: true }).click();
await page.getByText("Reward paid", { exact: true }).waitFor();
await page.screenshot({ path: "design/qa/paid-response.png", fullPage: true });
await writeFile(
  "design/qa/browser-report.json",
  JSON.stringify({ desktop, mobile, errors }, null, 2),
);
if (
  errors.length ||
  desktop.scrollWidth > desktop.width ||
  mobile.scrollWidth > mobile.width
)
  throw new Error("Browser checks failed");
await browser.close();
console.log(JSON.stringify({ desktop, mobile, errors }));
