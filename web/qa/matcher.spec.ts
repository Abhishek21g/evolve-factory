import { expect, test } from "@playwright/test";
import { closest, type Recording } from "../src/lib/replay";

/* The hosted composer's matcher (web/src/lib/replay.ts): typed text plays the recording closest in meaning, and a
 * request that contradicts every recording (another cohort, another amount) is not called a match. No browser needed. */

const rec = (id: string, kind: Recording["kind"], prompt: string): Recording => ({ id, project: "p", kind, prompt, wo: null, at: 0, callouts: null });
const CHILD = rec("w1", "whatif", "What if a child eats 80 g and the parent types the dose 10x?");
const ADULT = rec("w2", "whatif", "What if an adult eats 150 g of carbs?");
const VANE = rec("w3", "whatif", "What if the left AoA vane fails at 30 degrees?");
const BOLUS = rec("b1", "build", "Raise the single-bolus limit to 25 U");
const AOA = rec("b2", "build", "Add AoA disagree alert when the two sensors differ by more than 5 degrees");

test("matcher: numbers and cohort words decide, synonyms count, contradictions are not matches", () => {
  const pick = (recs: Recording[], text: string) => { const m = closest(recs, text)!; return [m.rec.id, m.matched]; };
  expect(pick([CHILD, ADULT], "What if an adult eats 150 g of carbs?")).toEqual(["w2", true]);
  expect(pick([CHILD, ADULT], "what if a kid eats 80 grams and the dose is typed ten times")).toEqual(["w1", true]);
  expect(pick([CHILD, ADULT], "What if an adult eats 80 g?")).toEqual(["w2", false]);  // right cohort, other amount
  expect(pick([CHILD], "What if an adult eats 150 g of carbs?")).toEqual(["w1", false]);  // the only recording, said plainly
  expect(pick([VANE], "what if the left vane gets stuck at 30 deg")).toEqual(["w3", true]);
  expect(pick([VANE], "Turbulence")).toEqual(["w3", false]);
  expect(pick([BOLUS], "Raise the single-bolus limit to 25 U")).toEqual(["b1", true]);
  expect(pick([AOA], "Supplier compliance: obtain DO-178C Software Accomplishment Summary from Flight control computer supplier (sample)")).toEqual(["b2", false]);
});
