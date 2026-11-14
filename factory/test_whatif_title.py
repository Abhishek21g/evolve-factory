"""Self-check: python3 factory/test_whatif_title.py  (what-if display titles; stdlib only)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import whatif_title  # noqa: E402

assert whatif_title.clean("trublanceh") == "Turbulence"
assert whatif_title.clean("  what if   the vane fails ") == "What if the vane fails"
assert whatif_title.clean("What if the left AoA vane fails at 30 degrees?") == "What if the left AoA vane fails at 30 degrees?"
assert whatif_title.title("trublanceh", "Read 'trublanceh' as turbulence and tested gust-driven AoA spikes.") == "Turbulence"

evs = [{"run": "1", "t": 0, "agent": "simulation", "state": "working", "msg": "", "title": "trublanceh"},
       {"run": "1", "t": 1, "agent": "simulation", "state": "done", "msg": "Read 'trublanceh' as turbulence and tested it"},
       {"run": "1", "t": 2, "agent": "world", "state": "done", "msg": "", "world": {"question": "trublanceh"}},
       {"run": "2", "t": 0, "agent": "planner", "state": "working", "msg": "", "title": "add an alarm", "wo": "WO-101"}]
whatif_title.apply(evs)
assert (evs[0]["title"], evs[0]["asked"]) == ("Turbulence", "trublanceh")
assert evs[2]["world"] == {"question": "Turbulence", "asked": "trublanceh"}
assert evs[3]["title"] == "add an alarm" and "asked" not in evs[3], "work order titles are left alone"
print("whatif_title ok")
