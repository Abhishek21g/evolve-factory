#include <math.h>
#include "fcc.h"

void fcc_init(fcc_state *s) {
    s->trim_deg = 0.0;
    s->aoa_deg = 0.0;
    s->aoa_valid = 0;
    s->active = 0;
}

static int in_range(double a) {
    return a >= AOA_MIN_VALID_DEG && a <= AOA_MAX_VALID_DEG;
}

double fcc_step(fcc_state *s, double aoa_l_deg, double aoa_r_deg, double dt_s) {
    double step = TRIM_RATE_DEG_S * dt_s;
    s->aoa_valid = in_range(aoa_l_deg) && in_range(aoa_r_deg) && fabs(aoa_l_deg - aoa_r_deg) <= AOA_DISAGREE_DEG;
    s->aoa_deg = (aoa_l_deg + aoa_r_deg) / 2.0;
    if (!s->aoa_valid)
        s->active = 0;  /* never act on AoA data we cannot trust */
    else if (s->aoa_deg > AOA_PROTECT_DEG)
        s->active = 1;
    else if (s->aoa_deg < AOA_RELEASE_DEG)
        s->active = 0;
    s->trim_deg += s->active ? step : -step;
    if (s->trim_deg > MAX_NOSE_DOWN_DEG)
        s->trim_deg = MAX_NOSE_DOWN_DEG;
    if (s->trim_deg < 0.0)
        s->trim_deg = 0.0;
    return s->trim_deg;
}
