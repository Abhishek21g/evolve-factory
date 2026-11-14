import { expect, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS || "qa-results/shots";

export const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
export const userMenu = (page: Page) => page.getByTestId("user-menu");

export async function signOut(page: Page) {
  await userMenu(page).click();
  await page.getByTestId("sign-out").click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
