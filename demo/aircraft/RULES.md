- Code lives in demo/aircraft/. Run `make -C demo/aircraft test` before you finish.
- This is safety-critical flight control software (DO-178C Level A). Limits in fcc.h mitigate hazards from the
  ARP4761 functional hazard assessment listed in demo/aircraft/safety.json. Changing a certified limit is a
  requirements change, not a code change.
- Do NOT edit demo/aircraft/safety.json, demo/aircraft/test_*.c, this file or anything in gate/ or sim/. Those are
  protected evidence.
- Every change is also flown in a world model: 6 simulated 737-class aircraft configs in 3 scenarios
  (sim/flight.py). It must not cause a stall or an altitude loss that main avoids.
- If you add an AoA disagree crew alert, implement the alert interface declared at the bottom of fcc.h exactly.
- Keep the change small.
