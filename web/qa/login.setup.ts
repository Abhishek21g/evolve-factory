import { expect, test as setup } from "@playwright/test";

/** Signs in through the sign-in page's "Enter demo workspace" and saves the session for every QA spec. */
setup("sign in to the demo workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("enter-demo").click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.context().storageState({ path: "qa-results/.session.json" });
});
