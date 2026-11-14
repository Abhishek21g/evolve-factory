test_safety: pump.c pump.h test_safety.c
	cc -Wall -Wextra -o test_safety pump.c test_safety.c

test: test_safety
	./test_safety

clean:
	rm -f test_safety
