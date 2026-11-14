/* One test per safety requirement (DO-178C requirements-based tests, normal range + robustness).
 * Run one: ./test_fcc SR-1   Run all: ./test_fcc
 * Tests pin the certified limits, not just the macros, so changing a limit fails its SR. */
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "fcc.h"

#define DT 0.02  /* 50 Hz control cycle */
#define EPS 1e-9

static double max_step;  /* largest trim change in one cycle during the last run() */

/* Hold both vanes at l / r for `seconds`; returns the final trim command. */
static double run(fcc_state *s, double l, double r, double seconds) {
    double trim = s->trim_deg;
    max_step = 0.0;
    for (int i = 0; i < (int)(seconds / DT + 0.5); i++) {
        double next = fcc_step(s, l, r, DT);
        if (fabs(next - trim) > max_step) max_step = fabs(next - trim);
        trim = next;
    }
    return trim;
}

/* SR-1: nose-down authority is 2.5 deg, used in full at deep stall AoA and never exceeded. */
static int sr1(void) {
    fcc_state s; fcc_init(&s);
    double t = run(&s, 25.0, 25.0, 30.0);
    return t <= 2.5 + EPS && t >= 2.5 - EPS;
}

/* SR-2: no nose-down trim from AoA data that is out of range or disagrees by more than 5.5 deg. */
static int sr2(void) {
    fcc_state s; fcc_init(&s);
    if (run(&s, 22.0, 4.0, 10.0) > EPS) return 0;   /* left vane failed high: 18 deg split */
    fcc_init(&s);
    if (run(&s, 16.0, 10.0, 10.0) > EPS) return 0;  /* 6 deg split */
    fcc_init(&s);
    if (run(&s, 35.0, 34.0, 10.0) > EPS) return 0;  /* both out of range */
    fcc_init(&s);
    double before = run(&s, 16.0, 16.0, 2.0);       /* protection active, then the left vane fails */
    double after = run(&s, 22.0, 4.0, 0.1);
    return before > 0.0 && after <= before;
}

/* SR-3: protection is available whenever the sources agree within 5.5 deg and AoA exceeds 12 deg,
 * including the split a sideslip gust puts between the two fuselage-mounted vanes. */
static int sr3(void) {
    fcc_state s; fcc_init(&s);
    if (run(&s, 16.0, 16.0, 1.0) <= 0.0) return 0;
    fcc_init(&s);
    if (run(&s, 12.5, 12.5, 1.0) <= 0.0) return 0;
    fcc_init(&s);
    if (run(&s, 15.65, 10.35, 1.0) <= 0.0) return 0;  /* 5.3 deg split, mean 13 */
    fcc_init(&s);
    return run(&s, 15.75, 10.25, 1.0) > 0.0;          /* 5.5 deg split: still trusted */
}

/* SR-4: protection never latches: below 10 deg AoA the trim returns to zero and stays there. */
static int sr4(void) {
    fcc_state s; fcc_init(&s);
    if (run(&s, 16.0, 16.0, 10.0) < 2.5 - EPS) return 0;
    if (run(&s, 9.0, 9.0, 6.0) > EPS) return 0;
    return run(&s, 9.0, 9.0, 20.0) <= EPS;
}

/* SR-5: the stabilizer never moves faster than 0.5 deg/s under protection. */
static int sr5(void) {
    fcc_state s; fcc_init(&s);
    double t = run(&s, 20.0, 20.0, 1.0);
    if (t > 0.5 + EPS || max_step > 0.5 * DT + EPS) return 0;
    run(&s, 20.0, 20.0, 10.0);
    run(&s, 5.0, 5.0, 1.0);
    return max_step <= 0.5 * DT + EPS;
}

static const struct { const char *id; int (*fn)(void); } T[] = {
    {"SR-1", sr1}, {"SR-2", sr2}, {"SR-3", sr3}, {"SR-4", sr4}, {"SR-5", sr5},
};

int main(int argc, char **argv) {
    int fails = 0;
    for (size_t i = 0; i < sizeof T / sizeof *T; i++) {
        if (argc > 1 && strcmp(argv[1], T[i].id)) continue;
        int ok = T[i].fn();
        printf("%s %s\n", T[i].id, ok ? "PASS" : "FAIL");
        fails += !ok;
    }
    return fails != 0;
}
