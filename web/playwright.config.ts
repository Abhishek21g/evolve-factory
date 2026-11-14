import { defineConfig } from "@playwright/test";

/** QA suite: `npm run qa` against a running factory server (QA_URL, default http://localhost:8787).
 *  Start one with `PORT=8917 demo/go.sh replay`, then `QA_URL=http://localhost:8917 npm run qa`.
 *  The setup project signs in with "Enter demo workspace" once; every spec reuses that session. */
export default defineConfig({
  testDir: "qa",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "qa-report" }]],
  outputDir: "qa-results",
  projects: [
    { name: "sign-in", testMatch: /login\.setup\.ts/ },
    { name: "qa", dependencies: ["sign-in"], use: { storageState: "qa-results/.session.json" } },
  ],
  use: {
    baseURL: process.env.QA_URL || "http://localhost:8787",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
