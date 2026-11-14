/* WO-200 extended bolus checks (test_*.c is protected evidence, so these live here). Run: make test */
#include <assert.h>
#include <stdio.h>
#include "pump.h"

static double run(pump_state *s, int minutes, int bg) {
    double before = s->delivered_today_u, max_min = 0;
    for (int i = 0; i < minutes; i++) {
        double b = s->delivered_today_u;
        extended_bolus_tick(s, bg);
        if (s->delivered_today_u - b > max_min) max_min = s->delivered_today_u - b;
    }
    assert(max_min * 60 <= MAX_BOLUS_U + 1e-9); /* no hour above 10 U */
    return s->delivered_today_u - before;
}

int main(void) {
    pump_state s = {0};
    pump_set_adult(&s, 1);
    /* SR-1 unchanged */
    assert(request_bolus(&s, 24.0, 120) == REJECT_LIMIT);
    /* confirmed large entry over 144 min = 10 U/h */
    assert(request_extended_bolus(&s, 24.0, 144, 120) == OK);
    assert(run(&s, 200, 120) > 23.999);

    /* unconfirmed large entry (no prior rejected request_bolus of that amount) */
    pump_state u = {0}; pump_set_adult(&u, 1);
    assert(request_extended_bolus(&u, 24.0, 144, 120) == REJECT_LIMIT);
    /* confirmation must match the amount */
    request_bolus(&u, 24.0, 120);
    assert(request_extended_bolus(&u, 20.0, 144, 120) == REJECT_LIMIT);
    /* rate limit: 24 U over 60 min is 24 U/h */
    request_bolus(&u, 24.0, 120);
    assert(request_extended_bolus(&u, 24.0, 60, 120) == REJECT_LIMIT);
    /* adult cap 25 U; non-adult cap 10 U */
    request_bolus(&u, 30.0, 120);
    assert(request_extended_bolus(&u, 30.0, 180, 120) == REJECT_LIMIT);
    pump_state c = {0};
    request_bolus(&c, 12.0, 120);
    assert(request_extended_bolus(&c, 12.0, 72, 120) == REJECT_LIMIT);
    assert(request_extended_bolus(&c, 6.0, 60, 120) == OK);

    /* SR-3: rejected below 70 mg/dL, and low BG mid-delivery cancels the rest */
    pump_state l = {0};
    assert(request_extended_bolus(&l, 6.0, 60, 69) == REJECT_LOW_BG);
    assert(request_extended_bolus(&l, 6.0, 60, 120) == OK);
    run(&l, 10, 120);
    assert(extended_bolus_tick(&l, 65) == REJECT_LOW_BG);
    double d = l.delivered_today_u;
    assert(run(&l, 60, 120) == 0 && l.delivered_today_u == d);

    /* SR-2: daily cap at request and during delivery */
    pump_state day = {.delivered_today_u = 55.0};
    assert(request_extended_bolus(&day, 6.0, 60, 120) == REJECT_DAILY);
    assert(request_extended_bolus(&day, 5.0, 60, 120) == OK);
    assert(request_bolus(&day, 4.0, 120) == OK); /* 59 U */
    run(&day, 60, 120);
    assert(day.delivered_today_u <= MAX_DAILY_U);

    puts("EXT PASS");
    return 0;
}
