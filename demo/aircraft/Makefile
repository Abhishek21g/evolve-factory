test_fcc: fcc.c fcc.h test_fcc.c
	cc -Wall -Wextra -o test_fcc fcc.c test_fcc.c -lm

alert_check: fcc.c fcc.h alert_check.c
	cc -Wall -Wextra -o alert_check fcc.c alert_check.c -lm

test: test_fcc alert_check
	./test_fcc
	./alert_check

clean:
	rm -f test_fcc alert_check
