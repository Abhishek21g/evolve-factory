import { expect, test } from "@playwright/test";
import { shot, signOut, userMenu } from "./helpers";

/* Integrations page: connected tools, Composio catalog, MCP servers (add + test), Certus Factory as an MCP server.
 *   QA_URL=http://localhost:8795 STATIC_URL=http://127.0.0.1:8796 npx playwright test qa/integrations.spec.ts */
const LIVE = process.env.QA_URL || "http://localhost:8787";
const STATIC = process.env.STATIC_URL || "";
test.use({ viewport: { width: 1440, height: 900 } });

test("live: integrations, Composio connect, MCP add + test, Certus MCP server", async ({ page, context }) => {
  await page.goto(`${LIVE}/?demo#/p/insulin-pump-firmware/overview`);
  await expect(userMenu(page)).toContainText("Abhishek Enaguthi");
  await page.getByRole("link", { name: "Manage integrations" }).click();
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  const connected = page.getByTestId("connected-now");
  for (const n of ["Claude Code", "8090 Software Factory", "HydraDB", "Composio · GitHub", "Vercel"]) await expect(connected).toContainText(n);
  await expect(page.getByTestId("catalog").getByRole("button", { name: /Connect/ })).toHaveCount(9);
  await expect(page.getByRole("button", { name: "Import requirements (coming soon)" })).toHaveCount(4);

  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("catalog").getByRole("button", { name: /Connect/ }).first().click()]);
  await popup.waitForURL(/composio\.dev|slack\.com/, { timeout: 30_000, waitUntil: "commit" });  // Composio link, then Slack OAuth
  await popup.close();

  const self = page.getByTestId("certus-mcp");
  await self.getByRole("button", { name: "Test connection" }).click();
  await expect(self.getByTestId("probe-ok")).toContainText("certus-factory 0.1.0");
  for (const t of ["get_trace", "get_verdict", "list_gaps", "recall_memory"]) await expect(self.getByTestId("probe-ok")).toContainText(t);
  await self.getByRole("tab", { name: "Claude Code" }).click();
  await expect(self).toContainText("claude mcp add certus-factory --");

  const add = page.getByTestId("add-mcp");
  await add.getByRole("button", { name: "DeepWiki (public)" }).click();
  await add.getByRole("button", { name: "Add server" }).click();
  const row = page.getByTestId("mcp-servers").locator("div.px-4", { hasText: "deepwiki" });
  await row.getByRole("button", { name: "Test connection" }).click();
  await expect(row.getByTestId("probe-ok")).toContainText("read_wiki_structure", { timeout: 20_000 });
  await page.getByRole("heading", { name: "MCP servers" }).scrollIntoViewIfNeeded();
  await shot(page, "05-mcp-servers");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => [...document.images].every(i => i.complete));  // plugin logos (the app polls, so never network-idle)
  await shot(page, "04-integrations", true);
  await row.getByRole("button", { name: "Remove deepwiki" }).click();
  await expect(page.getByTestId("mcp-servers")).not.toContainText("deepwiki");
  await signOut(page);
});

test("static export: integrations are read-only", async ({ page }) => {
  test.skip(!STATIC, "set STATIC_URL to web/out served statically");
  await page.goto(`${STATIC}/?snapshot&demo#/settings/integrations`);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByText("Read-only snapshot: connecting tools")).toBeVisible();
  await expect(page.getByTestId("catalog").getByRole("button", { name: /Connect/ }).first()).toBeDisabled();
  await page.waitForFunction(() => [...document.images].every(i => i.complete));  // plugin logos (the app polls, so never network-idle)
  await shot(page, "07-static-integrations", true);
  await signOut(page);
});
