"""Self-check for gate/sf.py with the network stubbed out: python3 gate/test_sf.py"""
import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.dirname(__file__))
import sf  # noqa: E402

os.environ["SF_API_KEY"] = "sofa-ext-test"
calls = []


def fake(reply):
    def _send(req):
        calls.append((req.method, req.full_url.replace(sf.BASE, ""), json.loads(req.data) if req.data else None,
                      req.get_header("Authorization")))
        return 200, json.dumps(reply).encode()
    return _send


assert sf.wo_number("WO-12") == 12 and sf.wo_number("7") == 7
try:
    sf.wo_number("banana"); raise SystemExit("bad id accepted")
except sf.SFError:
    pass

sf._send = fake({"data": {"id": "uuid-1", "work_order_number": 12, "title": "Bolus", "status": "ready",
                          "markdown_content": "Do it", "connectedContext": [{"resourceType": "r", "resourceId": "1"}]}})
w = sf.get_wo("WO-12")
assert calls[-1][:2] == ("GET", "/work_orders/by_number/12") and calls[-1][3] == "Bearer sofa-ext-test"
assert w["id"] == "uuid-1" and w["text"] == "Do it" and w["status"] == "ready"

sf._send = fake({"status": "Succeeded"})
sf.set_status("uuid-1", "in_progress")
m, p, body, _ = calls[-1]
op = body["operations"][0]
assert (m, p) == ("POST", "/work_orders/batch_update") and op["operation_type"] == "UpdateStatus"
assert op["target"] == {"work_order_id": "uuid-1"} and op["patch"] == {"status": "in_progress"}
try:
    sf.set_status("uuid-1", "done"); raise SystemExit("bad status accepted")
except sf.SFError:
    pass

sf.link_pr("uuid-1", "https://github.com/o/r/pull/1")
assert calls[-1][:3] == ("POST", "/work_orders/uuid-1/pull_requests", {"url": "https://github.com/o/r/pull/1"})


def boom(req):
    raise urllib.error.HTTPError(req.full_url, 401, "no", {}, __import__("io").BytesIO(b'{"detail":"API key has expired"}'))


sf._send = boom
try:
    sf.health(); raise SystemExit("401 not raised")
except sf.SFError as e:
    assert "401" in str(e) and "expired" in str(e) and "sofa-ext-test" not in str(e)

del os.environ["SF_API_KEY"]
sf.load_env = lambda: None
try:
    sf.health(); raise SystemExit("missing key not caught")
except sf.SFError as e:
    assert "SF_API_KEY" in str(e)
print("ok")
