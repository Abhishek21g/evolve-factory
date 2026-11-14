import { expect, test, type Page } from "@playwright/test";

/* End to end through the UI, on both projects: build a work order and ask a what-if, then check every stage
 * renders. These start real jobs, so they only run with QA_E2E=1 against a server in replay mode
 * (`PORT=8917 demo/go.sh replay`), which plays the recorded runs and never calls an LLM. */

test.skip(!process.env.QA_E2E, "set QA_E2E=1 and point QA_URL at a replay-mode server");
test.setTimeout(8 * 60_000);

type Project = { id: string; name: string; device: string };
const VERDICT = /Approved to merge|Blocked/;

async function setup(page: Page) {
  const st = await (await page.request.get("/api/state")).json();
  expect(st.status?.replay, "e2e must run against a replay-mode server: it never calls an LLM").toBe(true);
  const problems: string[] = [];
  page.on("pageerror", e => problems.push(`uncaught: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
  return { projects: st.projects as Project[], problems };
}

/** The server runs one job at a time. */
async function idle(page: Page) {
  await expect.poll(async () => (await (await page.request.get("/api/state")).json()).status?.busy, { timeout: 6 * 60_000, intervals: [2000] }).toBe(false);
}

test("build: New work order, Create and run, verdict with evidence, on both projects", async ({ page }) => {
  const { projects, problems } = await setup(page);
  for (const p of projects) {
    await idle(page);
    await page.goto(`/#/p/${p.id}/work-orders`);
    await page.getByRole("button", { name: "New work order" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox").first()).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Create and run" }).click();
    await expect(page).toHaveURL(new RegExp(`#/p/${p.id}/work-orders/WO-\\d+$`));
    await expect(page.locator("main").getByText("Running").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("main").getByText(VERDICT).first()).toBeVisible({ timeout: 6 * 60_000 });
    for (const step of ["Context", "Hazard analysis", "Implementation", "Requirement tests", "World model", "Evidence pack", "Decision"])
      await expect(page.getByRole("link", { name: step, exact: true })).toBeVisible();
    await expect(page.locator("main figure").first(), `${p.name}: world-model chart`).toBeVisible();
    await page.getByRole("button", { name: "Evidence" }).click();
    await expect(page.getByRole("dialog")).toContainText(/\w{20,}|evidence/i);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Code change" }).click();
    await expect(page.getByRole("dialog").locator("pre")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  expect(problems).toEqual([]);
});

test("simulate: Home composer what-if lands on Simulations with a verdict, on both projects", async ({ page }) => {
  const { projects, problems } = await setup(page);
  for (const p of projects) {
    await idle(page);
    await page.goto(`/#/p/${p.id}/overview`);
    await page.locator("main button", { hasText: /^\s*What if/ }).first().click();
    await expect(page.getByRole("radio", { name: "Simulate" })).toHaveAttribute("data-state", "on");
    await page.locator("#composer").press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/p/${p.id}/world-model$`));
    await idle(page);
    await expect(page.locator("main").getByText(/^(SAFE|UNSAFE|AT RISK)$/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("main").getByText(/replayed from real run/).first()).toBeVisible();
  }
  expect(problems).toEqual([]);
});
