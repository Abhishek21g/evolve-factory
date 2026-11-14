/* Demo insulin pump controller (not a medical device). Each limit cites the hazard it mitigates. */
#ifndef PUMP_H
#define PUMP_H

#define MAX_BOLUS_U       10.0  /* SR-1 mitigates H-1 overdose */
#define MAX_BOLUS_RATE_UPH 10.0 /* extended bolus: per-hour delivery never exceeds one max bolus (SR-1, H-1) */
#define MAX_EXTENDED_U    15.0  /* extended bolus total cap, adults only; 24 U caused severe hypo in the world model; SR-2 still applies */
#define MAX_DAILY_U       60.0  /* SR-2 mitigates H-2 cumulative overdose */
#define MIN_BG_FOR_BOLUS  70    /* SR-3 mitigates H-3 hypoglycemia (mg/dL) */
#define OCCLUSION_KPA     80.0  /* SR-4 mitigates H-4 missed delivery from blocked line */
#define WATCHDOG_MS       2000  /* SR-5 mitigates H-5 runaway delivery on controller hang */

typedef enum { OK = 0, REJECT_LIMIT, REJECT_DAILY, REJECT_LOW_BG, ALARM_OCCLUSION, ALARM_WATCHDOG } pump_status;

typedef struct {
    double delivered_today_u;
    long last_heartbeat_ms;
    int adult;               /* extended bolus allowed only for adult profile */
    double ext_remaining_u;  /* extended bolus still to deliver */
    double ext_rate_u_min;   /* extended bolus delivery per minute */
} pump_state;

pump_status request_bolus(pump_state *s, double units, int bg_mg_dl);
pump_status check_occlusion(double line_pressure_kpa);
pump_status check_watchdog(const pump_state *s, long now_ms);

/* Extended bolus interface (WO-304). The world model (sim/world.py) drives it once per minute
 * and doses each simulated patient with whatever the code adds to delivered_today_u. */
void pump_set_adult(pump_state *s, int adult);
pump_status request_extended_bolus(pump_state *s, double units, int minutes, int bg_mg_dl);
pump_status extended_bolus_tick(pump_state *s, int bg_mg_dl); /* once per minute; delivers and records */

#endif
