# Traceability in Certus Factory

Every safety requirement is traced in both directions: up to the hazard it mitigates and the regulation clause that asks
for it, down to the code that implements it, the test that verifies it, the simulation scenarios that exercise it, and
the work orders and evidence packs that changed or re-verified it. The Traceability page shows this per project; every
node opens the code (at the exact lines), the doc section or the test.

Where the links come from:

| Link | Source |
|---|---|
| Hazard -> requirement | `safety.json` (`requirements[].hazards`) |
| Requirement -> code | `safety.json` symbols, located in the code at read time, so line ranges follow the code |
| Requirement -> test | `safety.json` test command; the test function is located in `test_*.c` |
| Hazard -> simulation scenario | the fixed gate scenarios in `sim/world.py` (pump) and `sim/flight.py` (aircraft) |
| Requirement -> work order, evidence | the gate result of each work order (`.runs/WO-x.gate.json`) |
| Hazard / requirement -> regulation clause | the clause table below (and DO-178C objectives in `demo/aircraft/safety.json`) |
| Anything added by a person | `trace/links-<device>.json`, written by the server, shown in the matrix and the evidence pack |

Coverage gaps are flagged red: a requirement with no code link or no test, a hazard with no mitigating requirement,
and code in the device's source files that no requirement traces to (DO-178C asks for no untraced code).

Clause summaries below are paraphrased for orientation; the standards themselves are the authority.

## Insulin pump: IEC 62304 and ISO 14971

### ISO 14971 §5.4 Identification of hazards and hazardous situations

The manufacturer identifies known and foreseeable hazards and the sequences of events that lead to hazardous
situations, in normal use and foreseeable misuse. In the factory: the hazard log `H-1..H-5` in `demo/pump/safety.json`.

### ISO 14971 §7.1 Risk control option analysis

For each risk that needs reducing, choose controls in priority order: inherent safety by design, protective measures
in the device, then information for safety. In the factory: each hazard is mitigated by a safety requirement that is a
protective measure in the firmware.

### ISO 14971 §7.2 Implementation and verification of risk control measures

Implement each chosen risk control, verify it was implemented, and verify that it is effective. In the factory: the
requirement's code link shows the implementation, its unit test verifies it, and the world model shows effectiveness
on simulated patients.

### IEC 62304 §5.2.3 Risk control measures in software requirements

Risk control measures implemented in software are written into the software requirements. In the factory:
`SR-1..SR-5` are those requirements.

### IEC 62304 §5.7.1 Tests for software requirements

Establish and run tests that cover every software requirement. In the factory: one unit test per requirement in
`demo/pump/test_safety.c`, run by the gate on every work order.

### IEC 62304 §7.3.3 Traceability

Document traceability from each hazardous situation to the software item, the software cause, the risk control
measure and its verification. This matrix is that record.

## Flight controls: DO-178C, ARP4754A, ARP4761, 14 CFR Part 25, DO-254

### Development assurance levels

One failure-condition classification sets the level in every standard: the ARP4761 FHA classifies the failure
condition, ARP4754A assigns the function and item DAL from it, and the item is built to that DO-178C software level
or DO-254 hardware level. Probability budgets as in the AC 25.1309-1 series.

| Failure condition | Budget per flight hour | DAL | DO-178C objectives (with independence) | In this project |
|---|---|---|---|---|
| Catastrophic | extremely improbable, < 1e-9 | A | 71 (30) | H-1, H-2; SR-1..SR-4 |
| Hazardous | extremely remote, < 1e-7 | B | 69 (18) | H-4; SR-5 |
| Major | remote, < 1e-5 | C | 62 (5) | H-3, H-5 |
| Minor | probable | D | 26 (2) | none |
| No safety effect | none | E | none | none |

A requirement carries the DAL of the worst hazard it mitigates (SR-1 mitigates H-1 and H-4, so it is DAL A).

### ARP4761 Functional hazard assessment

The FHA lists aircraft and system failure conditions, classifies their severity (catastrophic, hazardous, major,
minor, no effect) and sets the development assurance level. In the factory: `H-1..H-5` in `demo/aircraft/safety.json`
with severity, DAL and probability budget.

### ARP4754A Development assurance level assignment

ARP4754A (system development, since revised as ARP4754B) decomposes aircraft functions into systems and items,
assigns a Function DAL from the worst failure condition of each function and an Item DAL to each software or hardware
item (independent architecture can lower it). It asks that requirements be validated (right and complete) and the
implementation verified (meets them).

| ARP4754A process | What it expects | Trace evidence in the factory |
|---|---|---|
| Safety assessment (with ARP4761) | FHA, PSSA, SSA | hazards with severity, DAL and probability budget in `safety.json` |
| DAL assignment | FDAL per function, IDAL per item | `dal` on each hazard and requirement |
| Requirements capture | system to item requirements, traced | hazard -> requirement (`requirements[].hazards`) |
| Requirements validation | the requirements are correct and complete | world-model scenarios: a run that leaves the envelope while every requirement test passes is reported as a requirement gap |
| Implementation verification | tests and analyses against the requirements | requirement tests and the world model, run by the deterministic gate on every work order |
| Configuration management | identified, controlled baselines | git: each change on its own branch, evidence tied to its commits |
| Process assurance | the plans were followed | audit trail of every human and agent action |
| Certification coordination | plans and summaries for the authority | evidence pack per work order (not a certification plan) |

Not claimed: PSSA/SSA fault trees, independence, a certification plan.

### 14 CFR 25.1309(b) Failure condition probabilities

Catastrophic failure conditions must be extremely improbable and not result from a single failure; hazardous and major
conditions get their own probability budgets (see AC 25.1309-1). In the factory: the budget is on each hazard.

### 14 CFR 25.672 Stability augmentation and automatic systems

Failures of automatic and power-operated systems that affect flight characteristics must be signalled to the crew and
must be controllable by the pilot. In the factory: authority and rate limits (`SR-1`, `SR-5`) keep the protection
overpowerable. `H-3` (crew not alerted to unreliable AoA) has no requirement in `safety.json`: an approved work order
that adds the AOA DISAGREE alert closes it in the trace until its requirement is added.

### DO-178C §11.21 Trace data

Bidirectional trace data between system requirements, high-level and low-level requirements, source code and test
cases. In the factory: requirement -> code (file and lines) -> test, plus untraced-code detection in the other direction.

### DO-178C Annex A objectives

Tables A-1 to A-10 list the objectives per software level (71 at Level A). The ones cited per requirement in
`safety.json` are A-6 #1-2 and A-7 #3. How each table maps to trace evidence here:

| Table | Process | Objectives (Level A) | Trace evidence in the factory |
|---|---|---|---|
| A-1 | Software planning | 7 | not claimed: plans (PSAC, SDP, SVP) are written by people |
| A-2 | Software development | 7 | requirements in `safety.json`; code written by the coding agent in its own worktree |
| A-3 | Verification of high-level requirements | 7 | #6 traceable to system requirements: hazard -> requirement |
| A-4 | Verification of design (low-level requirements, architecture) | 13 | not claimed: no separate low-level requirements |
| A-5 | Verification of coding and integration | 9 | #5 source traceable to requirements: requirement -> code symbols, untraced-code list as the reverse check |
| A-6 | Testing of the integrated code | 5 | #1-2 complies with and is robust to the high-level requirements: one requirements-based test per requirement (normal range and robustness), run by the gate |
| A-7 | Verification of verification results | 9 | #3 high-level requirement test coverage: Requirements -> tests; #5-7 structural coverage (MC/DC at Level A) not claimed |
| A-8 | Configuration management | 6 | git branch and commits per work order, diff in the evidence pack |
| A-9 | Quality assurance | 5 | not claimed: needs independence |
| A-10 | Certification liaison | 3 | evidence pack per work order, input to the SOI reviews below |

### FAA Stages of Involvement (SOI 1-4)

The FAA and its designees review a DO-178C program at four stages (FAA Order 8110.49A):

| SOI | When | What is reviewed | What the factory provides |
|---|---|---|---|
| 1 Planning | plans complete | PSAC, development, verification, configuration and quality plans, standards | nothing: plans are written by people |
| 2 Development | a substantial part of development done | requirements, design, code, trace data | the live trace matrix: hazard -> requirement -> code, untraced code |
| 3 Verification | a substantial part of verification done | test cases, procedures and results, coverage, trace to requirements | per change: requirement test results, world-model runs, the evidence pack |
| 4 Final | before approval | accomplishment summary, configuration index, open problem reports | audit trail and evidence history across work orders |

### DO-254 Airborne electronic hardware

DO-254 (EUROCAE ED-80, recognized by AC 20-152A for custom micro-coded components: ASICs, PLDs, FPGAs) gives design
assurance levels A-E from the same failure classification. Its life cycle runs planning, requirements capture,
conceptual and detailed design, implementation and production transition, with validation, verification,
configuration management, process assurance and certification liaison throughout. Levels A and B add Appendix B
methods (architectural mitigation, service experience, or advanced verification such as elemental analysis or formal
methods). The plan is the PHAC; the closing summary is the HAS.

The same trace engine would carry a DO-254 trace; this project is software only, so no hardware items are traced:

| DO-254 trace | Same mechanism in the software trace |
|---|---|
| hazard -> hardware requirement | hazard -> requirement in `safety.json` |
| hardware requirement -> HDL module (VHDL, Verilog) | requirement -> code symbols, located in the source |
| requirement -> test bench and simulation result | requirement test and its gate result |
| HDL that no requirement traces to | the untraced-code list |

Boeing asked CertusAI about DO-254. Boeing is not a customer, and nothing here is Boeing code or data.

See also `docs/BOEING.md` for the regulatory background of the flight-controls project.
