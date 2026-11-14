// Screenshots of the key pages for both projects: node qa/shots.mjs <base-url> <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://localhost:8787";
const out = process.argv[3] || "qa-shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("console", m => { if (m.type() === "error") console.log(`console error on ${page.url()}: ${m.text()}`); });
const state = await (await fetch(`${base}/api/state`)).json();
const ids = Object.fromEntries(state.projects.map(p => [p.device, p.id]));
const shots = [["projects", "#/"]];
for (const [dev, tag] of [["insulin-pump", "pump"], ["flight-controls", "boeing"]]) {
  const p = ids[dev];
  if (!p) continue;
  for (const pg of ["overview", "work-orders", "world-model", "agents", "agents/world", "memory", "requirements", "traceability", "audit", "team"])
    shots.push([`${tag}-${pg.replace("/", "-")}`, `#/p/${p}/${pg}`]);
  const wos = (await (await fetch(`${base}/api/state?project=${p}`)).json()).work_orders || [];
  if (wos.length) shots.push([`${tag}-work-order`, `#/p/${p}/work-orders/${wos[wos.length - 1].id}`]);
}
for (const [name, hash] of shots) {
  await page.goto(`${base}/?demo${hash}`);  // ?demo: enter the demo workspace (sign-in page)
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: name.includes("world-model") || name.includes("work-order") });
  if (name.endsWith("overview")) {
    await page.locator("textarea").first().click().catch(() => {});
    await page.screenshot({ path: `${out}/${name}-composer.png`, clip: { x: 0, y: 0, width: 1440, height: 520 } });
  }
}
await browser.close();
console.log(`${shots.length} pages captured to ${out}`);
