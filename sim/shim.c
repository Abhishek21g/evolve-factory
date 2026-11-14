/* Stable bridge between the world model (sim/world.py) and any candidate pump.c.
 *
 * Compiled against the CANDIDATE's pump.h, so pump_state always has the candidate's real size and
 * layout; Python never mirrors the struct. Optional features are weak symbols: absent = not supported.
 * If a candidate declares the extended-bolus functions with different signatures this file fails to
 * compile, and the world model blocks the change with that compiler error (interface contract broken).
 */
#include <stdlib.h>
#include "pump.h"

void pump_set_adult(pump_state *s, int adult) __attribute__((weak));
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl) __attribute__((weak));
pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl) __attribute__((weak));

void *sim_new(int adult) {
    pump_state *s = calloc(1, sizeof *s);
    if (s && adult && pump_set_adult) pump_set_adult(s, 1);
    return s;
}
void sim_free(void *s) { free(s); }
double sim_delivered(void *s) { return ((pump_state *)s)->delivered_today_u; }
int sim_bolus(void *s, double units, int bg) { return request_bolus(s, units, bg); }
int sim_has_ext(void) { return request_extended_bolus != 0 && extended_bolus_tick != 0; }
int sim_ext(void *s, double units, int minutes, int bg) { return request_extended_bolus(s, units, minutes, bg); }
int sim_tick(void *s, int bg) { return extended_bolus_tick(s, bg); }
