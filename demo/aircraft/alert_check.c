/* WO-344: AOA DISAGREE alert boundary checks (5.0 deg alert; 5.5 deg protection inhibit unchanged). */
#include <assert.h>
#include <stdio.h>
#include "fcc.h"

int main(void) {
    fcc_state s; fcc_init(&s);
    fcc_step(&s, 10.0, 15.0, 0.02);   /* 5.0 apart: no alert, sources valid */
    assert(!fcc_aoa_disagree(&s) && s.aoa_valid);
    fcc_step(&s, 10.0, 15.25, 0.02);  /* 5.25 apart: alert, protection still trusts sources */
    assert(fcc_aoa_disagree(&s) && s.aoa_valid);
    fcc_step(&s, 10.0, 15.5, 0.02);   /* 5.5 apart: alert, still valid (SR-2 limit unchanged) */
    assert(fcc_aoa_disagree(&s) && s.aoa_valid);
    fcc_step(&s, 10.0, 15.6, 0.02);   /* beyond 5.5: alert, protection inhibited */
    assert(fcc_aoa_disagree(&s) && !s.aoa_valid);
    fcc_step(&s, 5.0, 31.0, 0.02);    /* vane out of range */
    assert(fcc_aoa_disagree(&s));
    fcc_step(&s, 5.0, 5.0, 0.02);
    assert(!fcc_aoa_disagree(&s));

    /* Alert is read-only: same trim as a run that never queries it. */
    fcc_state a, b; fcc_init(&a); fcc_init(&b);
    for (int i = 0; i < 1000; i++) {
        double l = 14.0, r = 14.0 + (i % 2 ? 5.3 : 0.0);
        double ta = fcc_step(&a, l, r, 0.02); (void)fcc_aoa_disagree(&a);
        double tb = fcc_step(&b, l, r, 0.02);
        assert(ta == tb);
    }
    puts("ALERT PASS");
    return 0;
}
