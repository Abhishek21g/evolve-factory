import { expect, test, type Page } from "@playwright/test";

/* Hosted site (no factory server, e.g. Vercel or `python3 -m http.server -d web/out`): the composer plays recorded
 * runs in the browser (web/src/lib/replay.ts). ?speed=8 plays them 8x faster than recorded. */

type Recording = { id: string; project: string; kind: "build" | "whatif"; prompt: string; wo: string | null };
const PUMP_WORDS = /\b(bolus|glucose|insulin|hypoglyc\w*|virtual patients?|child eats|pump\.c)\b/i;

async function recordings(page: Page): Promise<Recording[]> {
  const api = await page.request.get("/api/state");
  test.skip(api.ok() && (api.headers()["content-type"] || "").includes("json"), "a factory server answers: not a hosted site");
  return (await (await page.request.get("/snapshot.json")).json()).replays || [];
}

/** Errors while the page is used. The UI's probe for a factory server (GET /api/state) is expected to 404 here. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", e => problems.push(`uncaught: ${e.message}`));
  page.on("response", r => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith("/api/")) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return problems;
}

test("hosted: typing the pump request plays the recorded run, BLOCKED then APPROVED, with evidence and the loop", async ({ page }) => {
  const recs = await recordings(page);
  const rec = recs.find(r => r.kind === "build" && /single-bolus limit/.test(r.prompt));
  expect(rec, "the snapshot exports the pump's recorded build").toBeTruthy();
  const problems = watch(page);
  await page.goto(`/?speed=8#/p/${rec!.project}/overview`);
  await expect(page.locator("main button", { hasText: rec!.prompt })).toBeVisible();
  await page.locator("#composer").fill("Raise the single-bolus limit to 25 U");
  await page.locator("#composer").press("Enter");
  await expect(page).toHaveURL(/#\/p\/[^/]+\/work-orders\/WO-\d+$/);
  const wo = page.url().split("/").pop()!;
  expect(wo, "a new work order, not the recorded one").not.toBe(rec!.wo);
  const main = page.locator("main");
  await expect(main.getByText("Recorded run (replay)").first()).toBeVisible();
  await expect(main.getByText("Running", { exact: true }).first()).toBeVisible();
  await expect(main.getByText(/Attempt 1: BLOCKED/).first()).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("Approved to merge")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`Safety evidence pack: ${wo}`);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Code change" }).click();
  await expect(page.getByRole("dialog").locator("pre")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "World model loop" }).click();
  await expect(main).toContainText(wo);
  await expect(main.getByText("BLOCKED").first()).toBeVisible();
  await expect(main.getByText("PASS").first()).toBeVisible();
  await page.goto(`/#/p/${rec!.project}/work-orders`);
  await expect(page.locator(`main a[href="#/p/${rec!.project}/work-orders/${wo}"]`)).toContainText("Approved");
  expect(problems).toEqual([]);
});

test("hosted: a Boeing what-if plays its recording, unmatched text says so, and no pump content reaches Boeing", async ({ page }) => {
  const recs = await recordings(page);
  const air = recs.find(r => r.kind === "whatif" && /AoA vane/.test(r.prompt)) || recs.find(r => r.kind === "whatif" && !PUMP_WORDS.test(r.prompt) && r.project.includes("boeing"));
  expect(air, "the snapshot exports a Boeing what-if").toBeTruthy();
  const problems = watch(page);
  await page.goto(`/?speed=8#/p/${air!.project}/world-model`);
  await page.locator("main button", { hasText: air!.prompt }).click();
  await page.getByRole("button", { name: "Simulate" }).last().click();
  const main = page.locator("main");
  await expect(main.getByText(`What-if: “${air!.prompt}”`).or(main.getByText(/^What-if:/)).first()).toBeVisible();
  await expect(main.getByText("Recorded run (replay)").first()).toBeVisible({ timeout: 30_000 });
  await expect(main.locator("figure").first()).toBeVisible();
  await expect(page.locator("#composer")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#composer").fill("what if the hydraulics freeze");  // matches no recording: the closest one plays
  await page.locator("#composer").press("Enter");
  await expect(main.getByText("Hosted demo plays a recorded run").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#composer")).toBeEnabled({ timeout: 30_000 });
  await page.goto(`/#/p/${air!.project}/audit`);
  const audit = await main.innerText();
  expect(audit).toContain("asked the world model");
  expect(audit.match(PUMP_WORDS)?.[0], "pump content in the Boeing audit trail").toBeUndefined();
  expect(problems).toEqual([]);
});
