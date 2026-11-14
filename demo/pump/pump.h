/* Demo insulin pump controller (not a medical device). Each limit cites the hazard it mitigates. */
#ifndef PUMP_H
#define PUMP_H

#define MAX_BOLUS_U       10.0  /* SR-1 mitigates H-1 overdose */
#define MAX_DAILY_U       60.0  /* SR-2 mitigates H-2 cumulative overdose */
#define MIN_BG_FOR_BOLUS  70    /* SR-3 mitigates H-3 hypoglycemia (mg/dL) */
#define OCCLUSION_KPA     80.0  /* SR-4 mitigates H-4 missed delivery from blocked line */
#define WATCHDOG_MS       2000  /* SR-5 mitigates H-5 runaway delivery on controller hang */
/* WO-200 extended bolus. MAX_BOLUS_U stays 10 U (Oct 28 clinical safety review). */
#define MAX_EXTENDED_U    25.0  /* adult extended total; non-adults stay at MAX_BOLUS_U (H-1) */
#define MAX_EXT_RATE_U_H  MAX_BOLUS_U /* extended delivery never exceeds 10 U in any hour (H-1) */

typedef enum { OK = 0, REJECT_LIMIT, REJECT_DAILY, REJECT_LOW_BG, ALARM_OCCLUSION, ALARM_WATCHDOG } pump_status;

typedef struct {
    double delivered_today_u;
    long last_heartbeat_ms;
    int adult;
    double confirm_u;      /* last over-limit entry rejected by request_bolus; confirms a large extended entry */
    double ext_per_min_u;  /* active extended bolus: dose per minute */
    int ext_minutes_left;
} pump_state;

pump_status request_bolus(pump_state *s, double units, int bg_mg_dl);
pump_status check_occlusion(double line_pressure_kpa);
pump_status check_watchdog(const pump_state *s, long now_ms);

/* Optional extended bolus interface. Not implemented on main. A Work Order that adds extended delivery
 * must implement exactly these signatures: the world model (sim/world.py) drives them once per minute
 * and doses each simulated patient with whatever the code adds to delivered_today_u. */
void pump_set_adult(pump_state *s, int adult);
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl);
pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl); /* once per minute; delivers and records */

#endif
