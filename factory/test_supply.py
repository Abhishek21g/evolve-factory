"""Self-check: .venv/bin/python factory/test_supply.py  (sample data per device, risk flags, finance, project scoping,
connecting a supplier team and a submitted deliverable becoming a trace link). Writes only to a temp directory."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store  # noqa: E402
import supply  # noqa: E402
import tracelinks  # noqa: E402

tmp = tempfile.mkdtemp()
supply._added_path = lambda dev: os.path.join(tmp, f"supply-{dev}.json")
tracelinks.links_path = lambda dev: os.path.join(tmp, f"links-{dev}.json")

for dev in ("insulin-pump", "flight-controls"):
    s = supply._sample(dev)
    assert "fictional" in s["sample"].lower(), "sample data is labelled"
    sups = supply.suppliers(dev)
    ids = {x["id"] for x in sups}
    spec = json.load(open(os.path.join(supply.ROOT, store.DEVICES[dev]["repo"], "safety.json")))
    items = {r["id"] for r in spec["requirements"]} | {h["id"] for h in spec["hazards"]}
    for x in sups:
        assert "(sample)" in x["name"], f"{x['name']} is labelled sample"
        assert x["tier"] in (1, 2, 3) and x["kind"] in supply.KINDS
        assert x["parent"] is None or x["parent"] in ids, f"{x['id']} parent exists"
        assert set(x["affects"]) <= items, f"{x['id']} affects only this device's requirements/hazards"
        assert all(d["item"] in items for d in x["deliverables"] if d.get("item"))
    prts = supply.parts(dev, sups)
    assert all(p["supplier"] in ids and set(p["affects"]) <= items for p in prts)
    rk = supply.risks(sups, prts)
    kinds = {r["kind"] for r in rk}
    assert {"single_source", "import_delay", "missing_deliverable"} <= kinds, kinds
    assert kinds & {"expiring_cert", "expired_cert"}, "a certificate is expiring or expired"
print("sample data: labelled, tiers and parents valid, every link points at this device's requirements and hazards")

air = supply.suppliers("flight-controls")
vane = next(p for p in supply.parts("flight-controls", air) if p["name"] == "AoA vane sensor")
assert {"SR-3", "H-2"} <= set(vane["affects"]) and "single_source" in vane["flags"]
pump_names = {x["name"] for x in supply.suppliers("insulin-pump")}
assert not pump_names & {x["name"] for x in air if "magnet" not in x["name"].lower()}, "no pump supplier in Boeing"
print("AoA vane -> SR-3/H-2, single source; pump and Boeing suppliers are separate")

dev, spec = "flight-controls", json.load(open(os.path.join(supply.ROOT, "demo/aircraft/safety.json")))
for bad, why in [({"name": "", "kind": "hardware"}, "name"), ({"name": "X", "kind": "magic"}, "kind"),
                 ({"name": "X", "kind": "hardware", "tier": 2}, "parent"), ({"name": "X", "kind": "hardware", "tier": 7}, "tier"),
                 ({"name": "X", "kind": "hardware", "email": "nope"}, "email")]:
    try:
        supply.invite(dev, spec, bad)
        raise AssertionError(f"invite accepted a bad {why}")
    except ValueError:
        pass
sup = supply.invite(dev, spec, {"name": "Pitot probe supplier (sample)", "tier": 2, "parent": "SUP-2", "kind": "hardware",
                                "contact": "Ana", "email": "ana@pitot.example", "affects": ["SR-3", "H-2", "H-99"]})
assert sup["id"] == "SUP-8" and sup["status"] == "Invited" and sup["affects"] == ["SR-3", "H-2"]
assert all(d["status"] == "missing" for d in sup["deliverables"]) and len(sup["deliverables"]) == 3
try:
    supply.submit(dev, spec, "abhishek", {"supplier": sup["id"], "title": "Cert", "kind": "certificate", "item": "SR-3", "url": "not a url"})
    raise AssertionError("submit accepted a bad url")
except ValueError:
    pass
d = supply.submit(dev, spec, "abhishek", {"supplier": sup["id"], "deliverable": "D-1", "title": "DO-254 HAS", "kind": "cert_data",
                                          "item": "SR-3", "url": "https://docs.example/has.pdf", "expires": "2030-01-01"})
got = next(x for x in supply.suppliers(dev) if x["id"] == sup["id"])
assert got["deliverables"][0]["status"] == "submitted" and got["missing"] == 2
link = next(x for x in tracelinks.links(dev) if x["id"] == d["link"])
assert link["item"] == "SR-3" and link["kind"] == "url" and "Supplier deliverable" in link["label"]
assert "Supplier deliverable" in tracelinks.evidence_section(dev, spec, {"SR-3"}), "deliverable shows in the evidence pack"
assert not os.path.exists(supply._added_path("insulin-pump")), "Boeing changes never touch the pump"
print("connect supplier team: validated, requested deliverables created; a submitted deliverable is a trace link in the evidence pack")
print("ok")
