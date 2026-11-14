# Safety evidence pack: WO-344

**Request:** Add AoA disagree alert when the two sensors differ by more than 5 degrees
**Decision:** APPROVED (deterministic: unit tests + world model; no LLM in the approval path)
**Summary:** 5 requirements tested, 5 passed; world model PASS: 0 new envelope exceedances in 18 simulations, 0 pre-existing

## 1. Hazard analysis (Safety Analyst)
- Hazards in scope: H-3, H-1, H-2, H-5
- Requirements in scope: SR-2, SR-3, SR-1, SR-4, SR-5
- Risk: If the coder lowers the shared AOA_DISAGREE_DEG constant from 5.5 to 5 deg, or lets the alert path feed into fcc_step's trim logic, stall protection could turn off when the sources agree within 5.5 deg (violating SR-3 and causing H-2), or trim could act differently on bad AoA data (H-1), which turns a DAL C indication change into a DAL A control change.
- Guidance given to coding agent: Add a separate AOA_DISAGREE_ALERT_DEG = 5.0 constant and a read-only alert output computed from the same voted AoA inputs; leave AOA_DISAGREE_DEG at 5.5 and leave every trim output of fcc_step unchanged; set the alert when either vane is out of range; add tests for the 5.0 and 5.5 deg boundaries and rerun SR-1 through SR-5.
- New hazard proposed for the log: H-6 (Major, DAL C): the AOA DISAGREE alert is unreliable because the 5.0 deg alert threshold differs from the 5.5 deg protection-inhibit threshold, so between 5.0 and 5.5 deg the crew sees AOA DISAGREE while stall protection can still move trim. In addition, a difference near 5 deg from gusts or sensor noise can make the alert flicker with no persistence or hysteresis, which distracts the crew and erodes trust in the alert (alert fatigue).

## 2. Traceability (hazard to requirement to test, DO-178C trace data)

| Requirement | Hazards | DAL | DO-178C objectives | Test | Result |
|---|---|---|---|---|---|
| SR-1: Stall protection nose-down authority never exceeds 2.5 deg of stabilizer | H-1, H-4 | A | DO-178C A-6 #1-2 (EOC complies with and is robust to HLR); A-7 #3 (HLR test coverage) | `make -s -C demo/aircraft test_fcc && demo/aircraft/test_fcc SR-1` | PASS |
| SR-2: No nose-down trim from AoA data out of range or disagreeing by more than 5.5 deg | H-1 | A | DO-178C A-6 #2 (robustness to failed sensors); A-7 #3 (HLR test coverage) | `make -s -C demo/aircraft test_fcc && demo/aircraft/test_fcc SR-2` | PASS |
| SR-3: Stall protection engages above 12 deg AoA whenever the sources agree within 5.5 deg | H-2 | A | DO-178C A-6 #1 (normal-range tests); A-7 #3 (HLR test coverage) | `make -s -C demo/aircraft test_fcc && demo/aircraft/test_fcc SR-3` | PASS |
| SR-4: Protection never latches: trim returns to zero below 10 deg AoA | H-1 | A | DO-178C A-6 #1-2; A-7 #3 (HLR test coverage) | `make -s -C demo/aircraft test_fcc && demo/aircraft/test_fcc SR-4` | PASS |
| SR-5: Protection never moves the stabilizer faster than 0.5 deg/s | H-4, H-5 | B | DO-178C A-6 #1-2; A-7 #3 (HLR test coverage) | `make -s -C demo/aircraft test_fcc && demo/aircraft/test_fcc SR-5` | PASS |

## 3. World model verification (simulated 737-class aircraft, longitudinal flight model)

| Scenario | Config | Outcome | Peak AoA | Peak AoA on main | Alt loss ft | Result |
|---|---|---|---|---|---|---|
| sideslip-stall | 58 t fwd CG | peak AoA 14.2 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 14.2 | 14.2 | 754 | inside envelope |
| sideslip-stall | 58 t aft CG | peak AoA 13.0 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 13.0 | 13.0 | 614 | inside envelope |
| sideslip-stall | 66 t fwd CG | peak AoA 12.7 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 12.7 | 12.7 | 860 | inside envelope |
| sideslip-stall | 66 t aft CG | peak AoA 12.6 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 12.6 | 12.6 | 768 | inside envelope |
| sideslip-stall | 74 t fwd CG | peak AoA 12.4 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 12.4 | 12.4 | 953 | inside envelope |
| sideslip-stall | 74 t aft CG | peak AoA 12.6 deg; protection trim max 2.5 deg; AOA DISAGREE alert at 0.0 s | 12.6 | 12.6 | 925 | inside envelope |
| vane-failure | 58 t fwd CG | peak AoA 4.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 4.4 | 4.4 | 0 | inside envelope |
| vane-failure | 58 t aft CG | peak AoA 4.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 4.4 | 4.4 | 0 | inside envelope |
| vane-failure | 66 t fwd CG | peak AoA 5.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 5.4 | 5.4 | 0 | inside envelope |
| vane-failure | 66 t aft CG | peak AoA 5.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 5.4 | 5.4 | 0 | inside envelope |
| vane-failure | 74 t fwd CG | peak AoA 6.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 6.4 | 6.4 | 0 | inside envelope |
| vane-failure | 74 t aft CG | peak AoA 6.4 deg; protection trim max 0.0 deg; AOA DISAGREE alert at 10.0 s | 6.4 | 6.4 | 0 | inside envelope |
| turbulence | 58 t fwd CG | peak AoA 5.8 deg; protection trim max 0.0 deg | 5.8 | 5.8 | 17 | inside envelope |
| turbulence | 58 t aft CG | peak AoA 5.5 deg; protection trim max 0.0 deg | 5.5 | 5.5 | 16 | inside envelope |
| turbulence | 66 t fwd CG | peak AoA 6.5 deg; protection trim max 0.0 deg | 6.5 | 6.5 | 15 | inside envelope |
| turbulence | 66 t aft CG | peak AoA 6.3 deg; protection trim max 0.0 deg | 6.3 | 6.3 | 14 | inside envelope |
| turbulence | 74 t fwd CG | peak AoA 7.2 deg; protection trim max 0.0 deg | 7.2 | 7.2 | 13 | inside envelope |
| turbulence | 74 t aft CG | peak AoA 7.0 deg; protection trim max 0.0 deg | 7.0 | 7.0 | 12 | inside envelope |

Not claimed: MC/DC structural coverage (DO-178C A-7), DO-330 qualification of this gate, independence of verification.

## 4. Organization context used

- [work_order] WO-31 (closed): Inhibit stall protection on AoA disagree (post-MCAS)
- [work_order] WO-7 (closed): Add 2000 ms controller watchdog
- [chat] #pump-firmware Slack thread
- [run] WO-WARM3: Let adults take larger meal boluses
- [run] WO-WARM4: Add an alarm when the extended bolus is interrupted

_Generated by Certus Factory, 2026-11-14 03:21 PST. Standards: DO-178C DAL A, ARP4754A, ARP4761, 14 CFR 25.1309._
