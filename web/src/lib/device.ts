/** Copy that depends on the project's device. Keep the one-click requests in sync with HOME in factory/pipeline.py
 *  (those are pre-warmed, so a click replays a real run in seconds). */
export type Mode = "build" | "simulate";
export type Suggestion = readonly [Mode, string];

type DeviceCopy = {
  suggest: readonly Suggestion[];
  /** Prefill of the New work order dialog. */
  template: { title: string; description: string };
  whatIf: string;
  build: string;
  /** What the world-model step does for a work order. */
  worldStep: string;
  subject: string;
};

const PUMP: DeviceCopy = {
  suggest: [
    ["build", "Let adults take larger meal boluses"],
    ["build", "Add an alarm when the extended bolus is interrupted"],
    ["simulate", "What if a child eats 80 g and the parent types the dose 10x?"],
    ["simulate", "What if an adult eats 150 g of carbs?"],
  ],
  template: {
    title: "Let adults take larger meal boluses",
    description: "Adults with high insulin needs (carb ratio around 5) cannot cover a large meal with one 10 U bolus.",
  },
  whatIf: "What if a child eats 80 g and the parent types the dose 10x?",
  build: "Add an alarm when the extended bolus is interrupted",
  worldStep: "Pump firmware runs in simulated patients, compared with main",
  subject: "simulated patients",
};

const COPY: Record<string, DeviceCopy> = {
  "insulin-pump": PUMP,
  "flight-controls": {
    suggest: [
      ["build", "Add AoA disagree alert when the two sensors differ by more than 5 degrees"],
      ["simulate", "What if the left AoA vane fails at 30 degrees?"],
      ["simulate", "What if the pilot pulls to a stall in heavy turbulence?"],
    ],
    template: {
      title: "Add AoA disagree alert when the two sensors differ by more than 5 degrees",
      description: "Crews need an alert when the left and right angle-of-attack vanes disagree, before stall protection acts on a bad vane.",
    },
    whatIf: "What if the left AoA vane fails at 30 degrees?",
    build: "Add AoA disagree alert when the two sensors differ by more than 5 degrees",
    worldStep: "Flight control software flies 6 aircraft configs, compared with main",
    subject: "simulated flights",
  },
};

export const deviceCopy = (device: string) => COPY[device] || PUMP;
