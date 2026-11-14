"""Self-check: .venv/bin/python factory/test_tracelinks.py  (the file endpoint's traversal guard, over HTTP, and
trace-link validation)."""
import json
import os
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402
import tracelinks  # noqa: E402

httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{httpd.server_port}"


def get(path):
    try:
        with urllib.request.urlopen(f"{base}/api/trace/file?path={urllib.parse.quote(path, safe='')}") as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None


code, f = get("demo/pump/pump.c")
assert code == 200 and "request_bolus" in f["text"] and f["lines"] > 10, "a tracked repo file is served"
for bad in ["../../../../etc/passwd", "/etc/passwd", "demo/../.env", ".env", "demo/pump/../../.env", "factory/../../x",
            "..%2F..%2Fetc%2Fpasswd", "demo\\..\\.env", "demo/pump/pump.c\0", ".runs/factory.json", ".git/config", ""]:
    code, _ = get(bad)
    assert code == 404, f"traversal guard let through {bad!r}"
print("file endpoint: serves tracked files, refuses traversal, absolute paths, untracked and git-internal files")

spec = json.load(open(os.path.join(tracelinks.ROOT, "demo/pump/safety.json")))
dev = "selfcheck"


def rejects(body, why):
    try:
        tracelinks.add_link(dev, spec, "abhishek", body)
    except ValueError:
        return
    raise AssertionError(f"accepted a link with {why}")


try:
    rejects({"item": "SR-1", "kind": "code", "path": "../etc/passwd"}, "a path outside the repo")
    rejects({"item": "SR-1", "kind": "code", "path": "demo/pump/pump.c", "start": 1, "end": 9999}, "a line range out of bounds")
    rejects({"item": "SR-1", "kind": "code", "path": "demo/pump/pump.c", "start": 9, "end": 3}, "start after end")
    rejects({"item": "SR-1", "kind": "doc", "path": "docs/TRACEABILITY.md", "anchor": "no-such-section"}, "a missing doc section")
    rejects({"item": "SR-99", "kind": "url", "url": "https://example.com"}, "an unknown requirement")
    rejects({"item": "SR-1", "kind": "url", "url": "javascript:alert(1)"}, "a non-http URL")
    ok = tracelinks.add_link(dev, spec, "abhishek", {"item": "SR-3", "kind": "code", "path": "demo/pump/pump.c", "start": 3, "end": 10})
    doc = tracelinks.add_link(dev, spec, "abhishek", {"item": "SR-3", "kind": "doc", "path": "docs/TRACEABILITY.md",
                                                       "anchor": tracelinks.slug("IEC 62304 §7.3.3 Traceability")})
    assert [x["id"] for x in tracelinks.links(dev)] == [ok["id"], doc["id"]]
    tracelinks.remove_link(dev, ok["id"])
    assert [x["id"] for x in tracelinks.links(dev)] == [doc["id"]]
    print("trace links: validated (path in repo, line range in bounds, section exists), stored and removed")
finally:
    if os.path.exists(tracelinks.links_path(dev)):
        os.remove(tracelinks.links_path(dev))
httpd.shutdown()
print("OK")
