#include "pump.h"

pump_status request_bolus(pump_state *s, double units, int bg_mg_dl) {
    if (units > MAX_BOLUS_U) s->confirm_u = units; /* first entry of a large dose; see request_extended_bolus */
    if (units <= 0 || units > MAX_BOLUS_U) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->delivered_today_u += units;
    return OK;
}

void pump_set_adult(pump_state *s, int adult) { s->adult = adult != 0; }

/* Extended bolus: `units` spread evenly over `minutes` (<= MAX_EXT_MINUTES). SR-2 and SR-3 apply as in
 * request_bolus. Rate <= MAX_EXT_RATE_U_H, so no hour delivers more than one max bolus. An entry above
 * MAX_BOLUS_U is accepted only as a confirmation: the same amount must first have been rejected by request_bolus. */
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl) {
    double cap = s->adult ? MAX_EXTENDED_U : MAX_BOLUS_U;
    int confirmed = units <= MAX_BOLUS_U || units == s->confirm_u;
    s->confirm_u = 0;
    if (units <= 0 || units > cap + 1e-9 || minutes <= 0 || minutes > MAX_EXT_MINUTES || !confirmed
        || s->ext_minutes_left > 0) return REJECT_LIMIT;
    if (units * 60.0 > MAX_EXT_RATE_U_H * minutes + 1e-9) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->ext_per_min_u = units / minutes;
    s->ext_minutes_left = minutes;
    return OK;
}

/* Once per minute. Low BG or the daily cap cancels the rest of the extended bolus. */
pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl) {
    if (s->ext_minutes_left <= 0) return OK;
    pump_status st = bg_mg_dl < MIN_BG_FOR_BOLUS ? REJECT_LOW_BG
                   : s->delivered_today_u + s->ext_per_min_u > MAX_DAILY_U ? REJECT_DAILY : OK;
    if (st != OK) { s->ext_minutes_left = 0; return st; }
    s->delivered_today_u += s->ext_per_min_u;
    s->ext_minutes_left--;
    return OK;
}

pump_status check_occlusion(double line_pressure_kpa) {
    return line_pressure_kpa >= OCCLUSION_KPA ? ALARM_OCCLUSION : OK;
}

pump_status check_watchdog(const pump_state *s, long now_ms) {
    return now_ms - s->last_heartbeat_ms > WATCHDOG_MS ? ALARM_WATCHDOG : OK;
}
