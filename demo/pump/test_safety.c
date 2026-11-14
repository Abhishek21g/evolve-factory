/* One test per safety requirement. Run one: ./test_safety SR-1   Run all: ./test_safety
 * Tests pin the clinical limits, not just the macros, so raising a limit fails its SR. */
#include <stdio.h>
#include <string.h>
#include "pump.h"

static int sr1(void) { pump_state s = {0}; return request_bolus(&s, 10.0, 120) == OK && request_bolus(&s, 10.5, 120) == REJECT_LIMIT; }
static int sr2(void) { pump_state s = {55.0, 0}; return request_bolus(&s, 5.0, 120) == OK && request_bolus(&s, 0.5, 120) == REJECT_DAILY; }
static int sr3(void) { pump_state s = {0}; return request_bolus(&s, 2.0, 69) == REJECT_LOW_BG && request_bolus(&s, 2.0, 70) == OK; }
static int sr4(void) { return check_occlusion(79.9) == OK && check_occlusion(80.0) == ALARM_OCCLUSION; }
static int sr5(void) { pump_state s = {0, 1000}; return check_watchdog(&s, 3000) == OK && check_watchdog(&s, 3001) == ALARM_WATCHDOG; }

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
