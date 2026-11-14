#include "pump.h"

pump_status request_bolus(pump_state *s, double units, int bg_mg_dl) {
    if (units <= 0 || units > MAX_BOLUS_U) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->delivered_today_u += units;
    return OK;
}

pump_status check_occlusion(double line_pressure_kpa) {
    return line_pressure_kpa >= OCCLUSION_KPA ? ALARM_OCCLUSION : OK;
}

pump_status check_watchdog(const pump_state *s, long now_ms) {
    return now_ms - s->last_heartbeat_ms > WATCHDOG_MS ? ALARM_WATCHDOG : OK;
}

void pump_set_adult(pump_state *s, int adult) { s->adult = adult; }

/* WO-304: large meals for adults are spread over time. The 10 U single-bolus cap (SR-1) is unchanged;
 * per-hour delivery stays <= MAX_BOLUS_RATE_UPH, SR-2 daily cap and SR-3 low-BG lockout still apply. */
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl) {
    if (!s->adult || s->ext_remaining_u > 0) return REJECT_LIMIT;
    if (units <= 0 || units > MAX_EXTENDED_U || minutes < 60) return REJECT_LIMIT;
    if (units * 60.0 > MAX_BOLUS_RATE_UPH * minutes + 1e-9) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->ext_remaining_u = units;
    s->ext_rate_u_min = units / minutes;
    return OK;
}

/* Once per minute. Low BG cancels the rest (SR-3); never passes the daily cap (SR-2). */
pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl) {
    if (s->ext_remaining_u <= 0) return OK;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) { s->ext_remaining_u = 0; return REJECT_LOW_BG; }
    double dose = s->ext_rate_u_min < s->ext_remaining_u ? s->ext_rate_u_min : s->ext_remaining_u;
    if (s->delivered_today_u + dose > MAX_DAILY_U) { s->ext_remaining_u = 0; return REJECT_DAILY; }
    s->delivered_today_u += dose;
    s->ext_remaining_u -= dose;
    if (s->ext_remaining_u < 1e-9) s->ext_remaining_u = 0;
    return OK;
}
