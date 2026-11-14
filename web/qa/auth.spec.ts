import { expect, test, type Page } from "@playwright/test";
import { shot, signOut, userMenu } from "./helpers";

/* Sign-in page, route guard, both projects, sign-out and the audit trail, on the live factory and on the static export.
 * Other suites skip the sign-in page by opening the app with ?demo (enters the demo workspace).
 *   QA_URL=http://localhost:8795 STATIC_URL=http://127.0.0.1:8796 npx playwright test qa/auth.spec.ts
 * QA_URL: a running factory server. STATIC_URL: web/out served by any static server (opened with ?snapshot). */
const LIVE = process.env.QA_URL || "http://localhost:8787";
const STATIC = process.env.STATIC_URL || "";
test.use({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });  // signed out: tests the sign-in page itself

async function bothProjects(page: Page) {
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  for (const name of ["Insulin Pump Firmware", "Boeing Flight Controls"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole("link", { name: "All projects" }).click();
  }
}

test("live: route guard, sign in, both projects, sign out, audit trail", async ({ page }) => {
  await page.goto(`${LIVE}/#/p/insulin-pump-firmware/work-orders`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work Orders" })).toHaveCount(0);
  await page.goto(`${LIVE}/`);
  await expect(page.getByText("live factory")).toBeVisible();
  await shot(page, "01-sign-in");

  await page.getByRole("button", { name: /Continue with SSO/ }).click();
  await expect(page.getByRole("dialog")).toContainText("not configured for this workspace");
  await shot(page, "02-sso-dialog");
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: /Continue with GitHub/ }).click();
  await expect(page.getByRole("dialog")).toContainText("GitHub OAuth app");
  await page.getByRole("button", { name: "Close" }).first().click();

  await page.getByLabel("Work email").fill("murali@certus.ai");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await bothProjects(page);
  await expect(userMenu(page)).toContainText("Muralikrishna Inti");
  await expect(userMenu(page)).toContainText("CertusAI · Firmware engineer");
  await userMenu(page).click();
  await expect(page.getByTestId("sign-out")).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, "03-user-menu");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();  // the session survives a reload
  await signOut(page);
  const audit = (await (await page.request.get(`${LIVE}/api/state?project=insulin-pump-firmware`)).json()).audit;
  expect(audit.slice(0, 2).map((a: { action: string; object: string }) => `${a.action} ${a.object}`))
    .toEqual(["signed out murali@certus.ai", "signed in murali@certus.ai"]);
});

test("live: ?demo enters the demo workspace", async ({ page }) => {
  await page.goto(`${LIVE}/?demo#/p/boeing-flight-controls/overview`);
  await expect(userMenu(page)).toContainText("Abhishek Enaguthi");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await signOut(page);
});

test("static export: demo workspace, both projects, sign out", async ({ page }) => {
  test.skip(!STATIC, "set STATIC_URL to web/out served statically");
  await page.goto(`${STATIC}/?snapshot`);
  await expect(page.getByText("read-only snapshot").first()).toBeVisible();
  await shot(page, "06-static-sign-in");
  await page.getByTestId("enter-demo").click();
  await bothProjects(page);
  await signOut(page);
});
