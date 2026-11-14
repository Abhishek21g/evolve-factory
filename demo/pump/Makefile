test_safety: pump.c pump.h test_safety.c
	cc -Wall -Wextra -Wno-missing-field-initializers -o test_safety pump.c test_safety.c

ext_check: pump.c pump.h ext_check.c
	cc -Wall -Wextra -o ext_check pump.c ext_check.c

test: test_safety ext_check
	./test_safety
	./ext_check

clean:
	rm -f test_safety ext_check
