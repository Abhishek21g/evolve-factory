/* Demo flight control computer (FCC): angle-of-attack (AoA) stall protection for a 737-class airliner.
 * Not flight software. Each limit cites the safety requirement (SR) and hazard (H) it mitigates (safety.json). */
#ifndef FCC_H
#define FCC_H

#define AOA_STALL_DEG      15.0  /* wing stalls above this AoA, flaps up (reference for the world model) */
#define AOA_PROTECT_DEG    12.0  /* SR-3: protection trims nose down above this AoA (H-2 stall) */
#define AOA_RELEASE_DEG    10.0  /* SR-4: protection trims back to zero below this AoA, never latches (H-1) */
#define AOA_DISAGREE_DEG    5.5  /* SR-2: sources further apart are invalid, protection inhibited (H-1); 737 MAX AD 2020-24-02 value */
#define AOA_DISAGREE_ALERT_DEG 5.0 /* H-3: crew AOA DISAGREE alert above this split; alert only, never changes trim */
#define AOA_MIN_VALID_DEG -10.0  /* SR-2: readings outside the vane's range are sensor failures (H-1) */
#define AOA_MAX_VALID_DEG  30.0
#define MAX_NOSE_DOWN_DEG   2.5  /* SR-1: total nose-down stabilizer authority; the pilot can always overpower it (H-1, H-4) */
#define TRIM_RATE_DEG_S     0.5  /* SR-5: protection never moves the stabilizer faster than this (H-4) */

typedef struct {
    double trim_deg;   /* nose-down stabilizer trim currently applied by the protection (0..MAX_NOSE_DOWN_DEG) */
    double aoa_deg;    /* AoA the protection used last cycle (mean of both sources) */
    int    aoa_valid;  /* last cycle: both sources in range and agreeing */
    int    active;     /* protection is holding or adding nose-down trim */
    int    aoa_disagree; /* last cycle: a vane out of range or vanes differ by more than AOA_DISAGREE_ALERT_DEG */
} fcc_state;

void   fcc_init(fcc_state *s);
/* One control cycle (the world model runs it at 50 Hz). aoa_l_deg / aoa_r_deg: left and right AoA vanes.
 * Returns the stabilizer trim command in degrees, positive = nose down. */
double fcc_step(fcc_state *s, double aoa_l_deg, double aoa_r_deg, double dt_s);

/* Optional crew alert interface. Not implemented on main. A work order that adds an AoA disagree alert must
 * implement exactly this signature: the world model (sim/flight.py) reads it every cycle and reports when the
 * crew was alerted. Returns 1 while the AOA DISAGREE alert is shown to the crew. */
int fcc_aoa_disagree(const fcc_state *s);

#endif
