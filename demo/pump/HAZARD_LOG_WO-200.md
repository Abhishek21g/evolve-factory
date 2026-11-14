# WO-200 hazard log update (ISO 14971), for Safety Analyst review

`safety.json` is protected evidence, so this change does not edit it. The entries below are proposed for the Safety Analyst to add.

## Decision

The request was to raise `MAX_BOLUS_U` from 10 U to 25 U. That change is rejected because the Oct 28 clinical safety review prohibits raising the single-bolus cap. `MAX_BOLUS_U` stays at 10.0 and SR-1 is unchanged.

The large-meal need is covered by an extended bolus. The code implements the interface declared in `pump.h`: `pump_set_adult`, `request_extended_bolus` and `extended_bolus_tick`.

## Risk controls added

| Control | Hazard | Where |
|---|---|---|
| The extended delivery rate is at most `MAX_EXT_RATE_U_H` (10 U/h). No hour delivers more than one max bolus, and each 1-minute portion is about 0.17 U or less. | H-1 | `request_extended_bolus` |
| The extended delivery ends within `MAX_EXT_MINUTES` (2 h) of the request, so meal insulin is not still being delivered after the meal is absorbed (late hypoglycemia). | H-3 | `request_extended_bolus` |
| The extended total is at most `MAX_EXTENDED_U` (10 U/h x 2 h = 20 U) for adults. For other profiles it is at most `MAX_BOLUS_U` (10 U). | H-1, H-3 | `request_extended_bolus` |
| Confirmation: an extended entry above 10 U is accepted only when `request_bolus` rejected the same amount just before. The user must enter the large dose twice. A mismatched amount is rejected. | H-1 (decimal slip) | `request_bolus`, `request_extended_bolus` |
| Only one extended bolus can be active at a time. | H-1, H-2 | `request_extended_bolus` |
| SR-2 applies at the request and at every tick. Delivery stops at 60 U per day. | H-2 | `request_extended_bolus`, `extended_bolus_tick` |
| SR-3 applies at the request. If BG drops below 70 mg/dL during delivery, the remaining dose is cancelled. | H-3 | `request_extended_bolus`, `extended_bolus_tick` |

## Proposed safety.json entries

- **SR-7** (SR-6 is already proposed by the open carb-ratio finding): Extended bolus delivers at most 10 U per hour, finishes within 2 h, at most 20 U in total (adult), and accepts an entry above 10 U only after the same amount is confirmed. Hazard: H-1. Symbols: `MAX_EXTENDED_U`, `MAX_EXT_RATE_U_H`, `request_extended_bolus`, `extended_bolus_tick`. Test: `make -s -C demo/pump ext_check && demo/pump/ext_check`.
- Extend **SR-2** and **SR-3** symbols with `request_extended_bolus` and `extended_bolus_tick`.

## Traceability

- SR-1 to SR-5: `demo/pump/test_safety.c` (unchanged, all pass).
- Extended bolus controls: `demo/pump/ext_check.c` (run by `make -C demo/pump test`).

## Residual risk / open items

- Update after the 12 h world model (PR #26): the original 25 U cap with no duration limit let 24 U run over 144 min, which caused late severe hypoglycemia (adult#009 42 mg/dL at ~11 h, adult#010 53 mg/dL at ~8 h). The same 24 U given at once did not (64 and 79 mg/dL), so the cause is insulin delivered after the meal was absorbed. Limiting delivery to 2 h (20 U) removes these lows. Meals needing more than 20 U are rejected and need a separate decision (e.g. 20 U now, correct later).
- A decimal slip that the user confirms (enters twice) is still delivered, up to 20 U at 10 U/h. Each hour stays inside the existing single-bolus limit, and the BG < 70 suspend stops delivery. The open SR-6 proposal (single bolus capped relative to the carb ratio) would close this. That needs a separate Work Order.
- UVA/Padova simulation evidence comes from the `world-model` gate check (`sim/world.py`, 10 adults, `large-meal` and `decimal-slip` scenarios). The gate attaches it to the PR.
