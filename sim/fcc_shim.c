/* World-model shim: lets sim/flight.py allocate the candidate's own fcc_state, whatever fields it has. */
#include <stdlib.h>
#include "fcc.h"

void *sim_new(void) {
    fcc_state *s = calloc(1, sizeof *s);
    fcc_init(s);
    return s;
}

void sim_free(void *s) { free(s); }
