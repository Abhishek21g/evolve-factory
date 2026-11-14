"""Self-check: .venv/bin/python factory/test_auth.py
Sign-in over HTTP (demo workspace, email in demo mode, configured account), signed and tamper-proof session tokens,
sign-in and sign-out in the audit trail."""
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auth  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

store.log = lambda *a, **k: logged.append(a[:3])  # the test never writes the real audit trail
logged = []
httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{httpd.server_port}"


def call(path, body=None, token=""):
    req = urllib.request.Request(base + path, json.dumps(body).encode() if body is not None else None,
                                 {"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r), r.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as e:
        return e.code, json.load(e), ""


for k in ("CERTUS_DEMO_EMAIL", "CERTUS_DEMO_PASSWORD"):
    os.environ.pop(k, None)
assert call("/api/auth/config")[1]["demo_mode"] is True
code, r, cookie = call("/api/auth/login", {"demo": True})
assert code == 200 and r["user"]["org"] == "CertusAI" and r["user"]["actor"] == "abhishek" and "HttpOnly" in cookie, r
assert call("/api/auth/session", token=r["token"])[1]["user"]["email"] == "demo@certus.ai"
code, r, _ = call("/api/auth/login", {"email": "Murali@certus.ai", "password": "anything"})
assert code == 200 and r["user"]["name"] == "Muralikrishna Inti" and r["user"]["role"] == "Firmware engineer", r
assert call("/api/auth/login", {"email": "not-an-email"})[0] == 400
print("demo mode: demo workspace and any work email sign in; sessions are signed cookies + bearer tokens")

pw = secrets.token_urlsafe(12)  # generated per run: no credential in the repo
os.environ.update(CERTUS_DEMO_EMAIL="judge@certus.ai", CERTUS_DEMO_PASSWORD=pw)
assert call("/api/auth/config")[1]["demo_mode"] is False
assert call("/api/auth/login", {"email": "judge@certus.ai", "password": pw + "x"})[0] == 401
assert call("/api/auth/login", {"email": "other@certus.ai", "password": pw})[0] == 401
code, r, _ = call("/api/auth/login", {"email": "judge@certus.ai", "password": pw})
assert code == 200 and r["user"]["name"] == "Judge"
assert call("/api/auth/login", {"demo": True})[0] == 200, "the demo workspace always opens"
print("configured account: only that email + password signs in")

t = r["token"]
assert call("/api/auth/session", token=t[:-2] + ("AA" if not t.endswith("AA") else "BB"))[0] == 401, "a tampered signature is refused"
head, sig = t.split(".")
assert call("/api/auth/session", token=head[:-3] + "xyz." + sig)[0] == 401, "a tampered payload is refused"
assert auth.verify("garbage") is None and call("/api/auth/session")[0] == 401
code, _, cookie = call("/api/auth/logout", {}, token=t)
assert code == 200 and "Max-Age=0" in cookie
assert [a[1] for a in logged] == ["signed in"] * 4 + ["signed out"] and logged[-1][2] == "judge@certus.ai", logged
print("tampered tokens are refused; sign-in and sign-out are in the audit trail")
print("ok")
