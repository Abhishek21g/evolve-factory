import { expect, test, type Page } from "@playwright/test";

/* Smoke suite: every page of every project renders without console errors, failed requests or dead controls.
 * The click sweep clicks every button, tab, chip and link in the page body; side-effecting POSTs (runs,
 * what-ifs, new work orders, memory, trace links) are answered by the test, so the sweep changes nothing. */

type Project = { id: string; name: string; device: string };
const PAGES = ["overview", "agents", "memory", "requirements", "work-orders", "world-loop", "world-model", "traceability", "audit", "team"];
const MUTATING = /\/api\/(run|ask|whatif|workorders|projects|memory|trace\/links(\/delete)?|trace\/tests)$/;
const CLICKABLE = "main button, main a[href], main [role=tab], main [role=radio], main summary";
/** Already-active controls: clicking them again rightly changes nothing. */
const ACTIVE = "[aria-pressed=true],[aria-selected=true],[aria-checked=true],[data-state=on],[data-state=active],[aria-current=page],.react-flow__controls-fitview";
/** Words that belong to one device only: they must never show up on another device's pages. */
const FOREIGN: Record<string, RegExp> = {
  "flight-controls": /\b(bolus|glucose|insulin|hypoglyc\w*|virtual patients?|child eats|pump\.c|ISO 14971|IEC 62304)\b/i,
  "insulin-pump": /\b(AoA|angle of attack|stall|airliner|DO-178C|sideslip|vane)\b/i,
};

async function projects(page: Page): Promise<Project[]> {
  const r = await page.request.get("/api/state");
  expect(r.ok(), "factory server must be running at QA_URL").toBeTruthy();
  return (await r.json()).projects;
}

async function latestWO(page: Page, pid: string): Promise<string | null> {
  const wos = (await (await page.request.get(`/api/state?project=${pid}`)).json()).work_orders || [];
  return wos.length ? wos[wos.length - 1].id : null;
}

/** Console errors, uncaught exceptions and failed requests while the page is used. */
function watch(page: Page) {
  const problems: string[] = [];
  const ignore = process.env.QA_IGNORE ? new RegExp(process.env.QA_IGNORE) : null; // known, reported issues only
  const add = (x: string) => { if (!ignore?.test(x)) problems.push(x); };
  page.on("console", m => { if (m.type() === "error") add(`console error: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", e => add(`uncaught: ${e.message.slice(0, 300)}`));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("/api/connect/")) add(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on("requestfailed", r => { if (!r.failure()?.errorText.includes("ERR_ABORTED")) add(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  return problems;
}

/** Answer side-effecting POSTs in the test so clicking everything is safe; returns the paths that were called. */
async function dryRun(page: Page) {
  const called: string[] = [];
  await page.route(MUTATING, async (route, req) => {
    if (req.method() !== "POST") return route.continue();
    called.push(new URL(req.url()).pathname);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: "QA dry run: not started" }) });
  });
  return called;
}

const settle = (page: Page) => page.waitForTimeout(900);
const fingerprint = (page: Page) => page.evaluate(() => {
  const vals = [...document.querySelectorAll("input,textarea,select")].map(e => (e as HTMLInputElement).value).join("|");
  const html = document.body.innerHTML;
  let h = 0;
  for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
  return `${location.href}#${h}#${vals}#${document.querySelectorAll("[role=dialog]").length}`;
});

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 10_000 });
  await settle(page);
}

test.describe("every page, both projects", () => {
  test("pages render with no errors and no foreign-device content", async ({ page }) => {
    const problems = watch(page);
    for (const p of await projects(page)) {
      for (const pg of PAGES) {
        await open(page, `#/p/${p.id}/${pg}`);
        const text = await page.locator("main").innerText();
        expect(text, `${p.name} / ${pg} shows "not found"`).not.toMatch(/\bnot found\b/i);
        if (pg === "memory") continue; // org memory is shared across projects by design
        const foreign = text.match(FOREIGN[p.device] || /$^/);
        expect(foreign?.[0], `${p.name} / ${pg} shows another device's content`).toBeUndefined();
      }
    }
    await open(page, "#/");
    expect(problems).toEqual([]);
  });

  test("sidebar: every nav item, project switcher and actor menu work", async ({ page }) => {
    const problems = watch(page);
    const ps = await projects(page);
    await open(page, `#/p/${ps[0].id}/overview`);
    const nav = page.getByRole("navigation", { name: "Main" });
    const hrefs = await nav.getByRole("link").evaluateAll(as => as.map(a => a.getAttribute("href") || ""));
    for (const href of [...hrefs.filter(h => h !== "#/"), "#/"]) {  // "All projects" last: it swaps the nav to the all-projects one
      await nav.locator(`a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[/#]/g, "\\$&")}$`));
      await expect(page.locator("main h1").first()).toBeVisible();
    }
    for (const p of ps) {
      await open(page, `#/p/${ps[0].id}/work-orders`);
      await page.getByRole("button", { name: "Project" }).click();
      await page.getByRole("menuitem", { name: new RegExp(p.name) }).click();
      await expect(page).toHaveURL(new RegExp(`#/p/${p.id}/work-orders$`));
      await expect(page.getByRole("button", { name: "Project" })).toContainText(p.name);
    }
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "Muralikrishna Inti" }).click();
    await expect(page.getByTestId("user-menu")).toBeVisible();
    expect(problems).toEqual([]);
  });

  for (const pg of [...PAGES, "work-order"]) {
    test(`click sweep: ${pg}`, async ({ page, context }) => {
      const problems = watch(page);
      const called = await dryRun(page);
      context.on("page", p => p.close().catch(() => {})); // external links open a tab: that counts as working
      const dead: string[] = [];
      let clicked = 0;
      for (const p of await projects(page)) {
        const wo = pg === "work-order" ? await latestWO(page, p.id) : null;
        if (pg === "work-order" && !wo) continue;
        const url = wo ? `#/p/${p.id}/work-orders/${wo}` : `#/p/${p.id}/${pg}`;
        await open(page, url);
        const n = await page.locator(CLICKABLE).count();
        for (let i = 0; i < n; i++) {
          const el = page.locator(CLICKABLE).nth(i);
          if (!(await el.isVisible().catch(() => false)) || await el.isDisabled().catch(() => true)) continue;
          if (await el.evaluate((e, sel) => e.matches(sel), ACTIVE).catch(() => false)) continue;
          const label = `${p.name} / ${pg}: ${(await el.getAttribute("aria-label")) || (await el.innerText()).trim().slice(0, 50) || (await el.getAttribute("href")) || "(unlabelled)"}`;
          const href = await el.getAttribute("href");
          if (href !== null && (href === "#" || href === "")) { dead.push(`${label} (empty href)`); continue; }
          const before = await fingerprint(page);
          const calls = called.length;
          const popup = context.pages().length;
          await el.click({ timeout: 4000 }).catch(e => dead.push(`${label} (not clickable: ${String(e).split("\n")[0]})`));
          await page.waitForTimeout(350);
          clicked++;
          const after = await fingerprint(page);
          if (before === after && called.length === calls && context.pages().length === popup && !href?.startsWith("http")) dead.push(label);
          if (await page.locator("[role=dialog]").count()) {
            await page.keyboard.press("Escape");
            await expect(page.locator("[role=dialog]"), `${label}: Escape closes the dialog`).toHaveCount(0);
          }
          if (!page.url().endsWith(url)) {
            await expect(page.locator("main h1").first(), `${label} leads to a page`).toBeVisible();
            await open(page, url);
          }
        }
      }
      test.info().annotations.push({ type: "clicked", description: String(clicked) });
      expect(dead, "controls that did nothing").toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("hosted snapshot: every page renders read-only with no errors", async ({ page }) => {
    const problems = watch(page);
    for (const p of await projects(page)) {
      for (const pg of PAGES) {
        await page.goto(`/?snapshot#/p/${p.id}/${pg}`);
        await expect(page.locator("main h1").first()).toBeVisible({ timeout: 10_000 });
        if (pg === "memory") continue;
        const foreign = (await page.locator("main").innerText()).match(FOREIGN[p.device] || /$^/);
        expect(foreign?.[0], `snapshot ${p.name} / ${pg} shows another device's content`).toBeUndefined();
      }
    }
    expect(problems).toEqual([]);
  });
});
