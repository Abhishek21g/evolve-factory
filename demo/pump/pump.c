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

/* Large meals: spread over time. Rate never exceeds MAX_BOLUS_U per hour, total must fit the daily cap,
 * and every per-minute delivery goes through request_bolus (SR-1, SR-2, SR-3). */
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl) {
    if (!s->adult || units <= 0 || minutes <= 0 || units * 60 > MAX_BOLUS_U * minutes) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->ext_remaining_u = units;
    s->ext_rate_u_min = units / minutes;
    return OK;
}

pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl) {
    if (s->ext_remaining_u <= 1e-9) return OK;
    double u = s->ext_remaining_u < s->ext_rate_u_min ? s->ext_remaining_u : s->ext_rate_u_min;
    pump_status r = request_bolus(s, u, bg_mg_dl);
    if (r != OK) { s->ext_remaining_u = 0; return r; }  /* low BG or daily cap: cancel the rest */
    s->ext_remaining_u -= u;
    return OK;
}
