# Boeing: flight-controls project in Certus Factory

Why this exists: Boeing asked CertusAI about DO-254, and mentors asked to see the factory on aerospace software.
This page records the standards an aircraft program has to meet and what the demo project covers.

## 1. Context

Boeing asked CertusAI about **DO-254** (design assurance for airborne electronic hardware: FPGAs and ASICs).
**Boeing is not a customer**, and nothing in this project is Boeing code or data. DO-254 is hardware; this
project shows the same engine on the software side (**DO-178C**), which is the larger half of an aircraft
program's certification evidence. Defense programs need the same kind of evidence (MIL-STD-882E).

## 2. What a transport-aircraft program has to show (regulations and standards)

Public standards; identifiers and roles as commonly cited (RTCA, SAE, FAA, EASA).

| Layer | Standard | What it requires | In this project |
|---|---|---|---|
| Airworthiness rule | **14 CFR Part 25** (transport category). **25.1309**: catastrophic failure conditions extremely improbable (< 1e-9 per flight hour) and not from a single failure; hazardous < 1e-7, major < 1e-5. **25.672** stability augmentation and automatic systems; **25.201/203/207** stall demonstration, characteristics, warning | Every failure condition classified and shown to meet its probability budget | FHA severities and probability budgets on H-1..H-5 |
| Advisory | **AC 25.1309-1** series (system design and analysis); EASA **CS-25** and **AMC 25.1309** | Method for the 25.1309 safety assessment | |
| Aircraft / system development | **SAE ARP4754A** (now **ARP4754B**) | Requirements capture and validation, system to item decomposition, development assurance levels (FDAL / IDAL) from failure severity | Hazards carry a DAL; requirements inherit it |
| Safety assessment | **SAE ARP4761** (now **ARP4761A**) | FHA, PSSA, SSA, FTA, FMEA, common cause analysis | `demo/aircraft/safety.json` hazards are an FHA |
| Airborne software | **RTCA DO-178C** / EUROCAE ED-12C, recognized by FAA **AC 20-115D** | Software levels A-E from the failure condition (A catastrophic, B hazardous, C major, D minor, E no effect). Objectives tables A-1..A-10: Level A 71 objectives (with independence on many), B 69, C 62, D 26. Bidirectional trace data (section 11.21) system req -> high-level req -> low-level req -> source -> tests. Requirements-based tests, normal range and robustness (A-6), HLR/LLR test coverage and structural coverage: MC/DC for A, decision for B, statement for C (A-7) | SR-1..SR-5 are DAL A/B high-level requirements, each traced to code symbols, a requirements-based test and DO-178C objectives |
| Software supplements | **DO-330** tool qualification (TQL-1..5), **DO-331** model-based development, **DO-332** object-oriented, **DO-333** formal methods, **DO-248C** clarifications | Qualify any tool whose output is not verified (a gate that approves code is a verification tool) | Not claimed: the gate would need DO-330 qualification |
| Airborne hardware | **RTCA DO-254** / ED-80, recognized by **AC 20-152A** | Design assurance for FPGAs/ASICs, levels A-E, trace down to HDL and test benches. **This is what Boeing asked CertusAI about.** | Not in this demo (software only) |
| Environment | **RTCA DO-160G** | Environmental qualification of equipment (temperature, vibration, lightning, EMI) | Out of scope |
| Security | **DO-326A / DO-356A** (ED-202A / ED-203A) | Airworthiness security process | Out of scope |
| FAA oversight | **FAA Order 8110.49** (software approval), **Stages of Involvement (SOI) 1-4** | Audits at planning, development, verification and final; each reviews plans (PSAC, SDP, SVP, SCMP, SQAP), trace data and verification results | Evidence pack = SOI 3 style verification record per change |

### The MCAS lesson (why AoA protection)

The 737 MAX accidents (Lion Air 610, Oct 2018; Ethiopian 302, Mar 2019) came from MCAS, a pitch augmentation
function that trimmed the stabilizer nose down from a **single** AoA sensor, re-activated repeatedly, and could
exceed what pilots could counter. The FAA return-to-service directive (**AD 2020-24-02**, Nov 2020) and Boeing's
software update changed it to:

- compare **both** AoA sensors and not activate if they disagree by more than **5.5 deg** (flaps up);
- activate only **once** per high-AoA event;
- limit its authority so the pilot can always overpower it with the column;
- make the **AOA DISAGREE** alert standard (it had been tied to an optional display).

Congress followed with the Aircraft Certification, Safety, and Accountability Act (Dec 2020), which tightened
delegation (ODA) oversight and the treatment of pilot-assumption and system-safety assessments. Traceable evidence
for exactly this kind of change is what a prime and the FAA review at every SOI.

## 3. The demo project: "Boeing Flight Controls" (AoA stall protection)

A small codebase like the pump, built at the hackathon (not flight software, not Boeing data):

| Piece | File | What it is |
|---|---|---|
| Flight control code | `demo/aircraft/fcc.c`, `fcc.h` | 50 Hz AoA stall protection: votes two AoA vanes, inhibits on disagreement > 5.5 deg (SR-2, the post-AD rule), trims nose down above 12 deg AoA with 2.5 deg authority (SR-1, SR-3), never latches (SR-4), rate-limited to 0.5 deg/s (SR-5). No crew alert yet: H-3 is open |
| FHA + requirements | `demo/aircraft/safety.json` | Hazards H-1..H-5 with severity, DAL and probability budget (ARP4761 FHA); SR-1..SR-5 with DAL and DO-178C objectives, files, symbols, test |
| Requirement tests | `demo/aircraft/test_fcc.c` | One requirements-based test per SR (normal range + robustness), pinning certified values, not macros |
| World model | `sim/flight.py` | Plain-Python longitudinal flight model (lift with stall break, nacelle pitch-up near stall, drag, thrust, pitch damping), the candidate's compiled `fcc.c` in the loop. 3 scenarios x 6 configs (58/66/74 t, forward/aft CG): stall approach in a sideslip gust, left vane fails at 22 deg, moderate turbulence. Verdict: no new stall (true AoA > 15 deg) or altitude-loss exceedance vs main |
| Gate | `gate/checks-aircraft.json` | Protected files + requirement tests + world model, same deterministic gate as the pump |

**Stage request:** `Add AoA disagree alert when the two sensors differ by more than 5 degrees`

- The obvious patch reuses the existing AoA monitor for the alert and sets it to the requested 5 deg
  (`AOA_DISAGREE_DEG 5.5 -> 5.0`). It looks like half a degree. The gate blocks it: **SR-3 FAIL** (stall protection
  must stay available while the vanes agree within the certified 5.5 deg), and the world model shows **6 of 6
  aircraft stall** in the sideslip stall approach, because a sideslip splits the vanes by 5.3 deg and the
  protection is now switched off.
- The fix is a separate, alert-only 5 deg threshold (`fcc_aoa_disagree()`), leaving the certified 5.5 deg monitor
  alone. 5/5 requirement tests pass, 0 new exceedances, and the world model shows the crew alert firing at the
  vane failure.

What we do **not** claim: MC/DC structural coverage, DO-330 tool qualification, independence of verification,
real aircraft data, or DO-254. The flight model uses textbook-scale coefficients.
