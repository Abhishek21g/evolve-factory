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

## Flight controls: DO-178C, ARP4761, 14 CFR Part 25, DO-254

### ARP4761 Functional hazard assessment

The FHA lists aircraft and system failure conditions, classifies their severity (catastrophic, hazardous, major,
minor, no effect) and sets the development assurance level. In the factory: `H-1..H-5` in `demo/aircraft/safety.json`
with severity, DAL and probability budget.

### 14 CFR 25.1309(b) Failure condition probabilities

Catastrophic failure conditions must be extremely improbable and not result from a single failure; hazardous and major
conditions get their own probability budgets (see AC 25.1309-1). In the factory: the budget is on each hazard.

### 14 CFR 25.672 Stability augmentation and automatic systems

Failures of automatic and power-operated systems that affect flight characteristics must be signalled to the crew and
must be controllable by the pilot. In the factory: authority and rate limits (`SR-1`, `SR-5`) keep the protection
overpowerable; `H-3` (no AoA disagree alert) is the open gap.

### DO-178C §11.21 Trace data

Bidirectional trace data between system requirements, high-level and low-level requirements, source code and test
cases. In the factory: requirement -> code (file and lines) -> test, plus untraced-code detection in the other direction.

### DO-178C Annex A objectives

Tables A-1 to A-10 list the objectives per software level. The ones cited per requirement in `safety.json`:
A-6 #1-2 (executable object code complies with, and is robust to, the high-level requirements) and A-7 #3 (test
coverage of high-level requirements). Not claimed: structural coverage (A-7 #5-7) and independence.

### DO-254 Airborne electronic hardware

Design assurance for FPGAs and ASICs, traced down to HDL and test benches. Boeing asked CertusAI about DO-254. Not in
this project: it is software only, so no hardware items are traced.

See also `docs/BOEING.md` for the regulatory background of the flight-controls project.
