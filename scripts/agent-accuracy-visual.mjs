// Visual review for the public /accuracy scorecard page. Mounted outside
// Clerk, so no auth bypass is needed — the page renders signed out. Gateway
// calls are mocked; screenshots land in shots/accuracy/.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/accuracy", { recursive: true });

const observedAt = "2026-09-02T00:00:00.000Z";
const json = (value) => ({ status: 200, contentType: "application/json", body: JSON.stringify(value) });

const scorecard = json({
  totals: { graded: 214, hits: 131, hitRatePct: "61.21", pending: 12, voided: 5, lastGradedAt: observedAt },
  byCategory: [
    { category: "Economics", graded: 96, hits: 62, hitRatePct: "64.58" },
    { category: "Crypto", graded: 71, hits: 43, hitRatePct: "60.56" },
    { category: "Politics", graded: 32, hits: 19, hitRatePct: "59.38" },
    { category: "Sports", graded: 15, hits: 7, hitRatePct: "46.67" },
  ],
  recent: [
    { marketQuestion: "Will the Fed hold rates in September?", predictedOutcome: "Yes", gradedOutcome: "Yes", hit: true, madeAt: "2026-08-28T00:00:00.000Z", gradedAt: observedAt, category: "Economics" },
    { marketQuestion: "Will ETH close above $5,000 in August?", predictedOutcome: "Yes", gradedOutcome: "No", hit: false, madeAt: "2026-08-20T00:00:00.000Z", gradedAt: observedAt, category: "Crypto" },
    { marketQuestion: "Will a US recession be declared in 2026?", predictedOutcome: "No", gradedOutcome: "No", hit: true, madeAt: "2026-08-14T00:00:00.000Z", gradedAt: observedAt, category: "Economics" },
    { marketQuestion: "Will Bitcoin be above $100,000 on September 1?", predictedOutcome: "Yes", gradedOutcome: "Yes", hit: true, madeAt: "2026-08-10T00:00:00.000Z", gradedAt: observedAt, category: "Crypto" },
  ],
  observedAt,
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
let collectErrors = true;
page.on("pageerror", (error) => { if (collectErrors) errors.push(String(error)); });
page.on("console", (message) => {
  if (collectErrors && message.type() === "error") errors.push(message.text());
});

await page.route("**/v1/public/agent-accuracy", (route) => route.fulfill(scorecard));

// 1. Desktop, populated.
await page.goto("http://localhost:5173/accuracy", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const heading = await page.getByRole("heading", { name: "Prediction accuracy" }).count();
const categoryRows = await page.locator('[aria-label="Accuracy by category"] tbody tr').count();
const recentRows = await page.locator('[aria-label="Recent graded predictions"] tbody tr').count();
let shot = "shots/accuracy/desktop.png";
await page.screenshot({ path: shot, fullPage: true });
console.log(`saved ${shot} (heading=${heading}, categoryRows=${categoryRows}, recentRows=${recentRows})`);

// 2. 390px mobile.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
shot = "shots/accuracy/mobile.png";
await page.screenshot({ path: shot, fullPage: true });
console.log(`saved ${shot}`);

// 3. Error state with retry. The mocked 503 logs console errors by design,
// so page-error collection stops before this step.
collectErrors = false;
await page.setViewportSize({ width: 1440, height: 1000 });
await page.route("**/v1/public/agent-accuracy", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UPSTREAM", message: "mocked outage" } }) }));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
shot = "shots/accuracy/error.png";
await page.screenshot({ path: shot, fullPage: true });
console.log(`saved ${shot}`);

await browser.close();
let failed = false;
if (!heading) { console.error("FAIL: page heading missing"); failed = true; }
if (categoryRows !== 4) { console.error(`FAIL: expected 4 category rows, got ${categoryRows}`); failed = true; }
if (recentRows !== 4) { console.error(`FAIL: expected 4 recent rows, got ${recentRows}`); failed = true; }
if (errors.length) { console.error(`page errors:\n${errors.join("\n")}`); failed = true; }
if (failed) process.exit(1);
console.log("visual review assertions passed");