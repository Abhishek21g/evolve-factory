#include "pump.h"

pump_status request_bolus(pump_state *s, double units, int bg_mg_dl) {
    if (units <= 0 || units > MAX_BOLUS_U) return REJECT_LIMIT;
    if (bg_mg_dl < MIN_BG_FOR_BOLUS) return REJECT_LOW_BG;
    if (s->delivered_today_u + units > MAX_DAILY_U) return REJECT_DAILY;
    s->delivered_today_u += units;
    return OK;
}

pump_status quick_bolus(pump_state *s, int bg_mg_dl) {
    return request_bolus(s, 5.0, bg_mg_dl);
}

pump_status check_occlusion(double line_pressure_kpa) {
    return line_pressure_kpa >= OCCLUSION_KPA ? ALARM_OCCLUSION : OK;
}

pump_status check_watchdog(const pump_state *s, long now_ms) {
    return now_ms - s->last_heartbeat_ms > WATCHDOG_MS ? ALARM_WATCHDOG : OK;
}
