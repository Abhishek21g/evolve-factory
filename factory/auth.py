"""Sign-in for the factory UI: one demo account, a signed session token, sign-in/sign-out in the audit trail.

Hackathon-honest: there is no user database and no SSO. Configure the demo account with
  CERTUS_DEMO_EMAIL, CERTUS_DEMO_PASSWORD   (both set: only that email + password signs in)
  CERTUS_SESSION_SECRET                     (optional; else a random key kept in .runs/session.key)
Without CERTUS_DEMO_PASSWORD the server is in demo mode: any email signs in. "Enter demo workspace" always works.
The token is HMAC-SHA256 signed, sent as an HttpOnly cookie and returned to the UI (static pages keep it in localStorage).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

import store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COOKIE = "certus_session"
TTL = 7 * 86400
ORG = "CertusAI"
DEMO_EMAIL = "demo@certus.ai"


def _secret():
    if os.environ.get("CERTUS_SESSION_SECRET"):
        return os.environ["CERTUS_SESSION_SECRET"].encode()
    p = os.path.join(ROOT, ".runs", "session.key")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(secrets.token_hex(32))
    return open(p).read().strip().encode()


def config():
    return {"demo_mode": not os.environ.get("CERTUS_DEMO_PASSWORD"), "sso": False, "github": False}


def user_for(email):
    """The team member an email signs in as (matched on the first name), else a guest who acts as the safety lead."""
    local = email.split("@")[0].lower()
    m = next((m for m in store.TEAM if m["kind"] == "human" and local.startswith(m["id"])), None)
    if m:
        return {"email": email, "name": m["name"], "role": m["role"], "org": ORG, "actor": m["id"]}
    name = " ".join(w.capitalize() for w in local.replace("_", ".").replace("-", ".").split(".") if w) or "Guest"
    return {"email": email, "name": name, "role": "Reviewer", "org": ORG, "actor": "abhishek"}


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def issue(user, method):
    payload = _b64(json.dumps({**user, "method": method, "exp": int(time.time()) + TTL}).encode())
    return payload + "." + _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())


def verify(token):
    try:
        payload, sig = token.split(".")
        if not hmac.compare_digest(sig, _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return data if data["exp"] > time.time() else None
    except (ValueError, KeyError):
        return None


def token_from(headers):
    a = headers.get("Authorization", "")
    if a.startswith("Bearer "):
        return a[7:]
    for part in headers.get("Cookie", "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return ""


def cookie(token, max_age=TTL):
    return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"


def handle(path, body, headers):
    """(status, json, extra headers) for /api/auth/*."""
    if path == "/api/auth/config":
        return 200, config(), {}
    if path == "/api/auth/session":
        s = verify(token_from(headers))
        return (200, {"user": s}, {}) if s else (401, {"error": "not signed in"}, {})
    if path == "/api/auth/logout":
        s = verify(token_from(headers))
        if s:
            store.log(s["actor"], "signed out", s["email"], f"{s['name']} · {ORG}")
        return 200, {"ok": True}, {"Set-Cookie": cookie("", 0)}
    if path == "/api/auth/login":
        demo = bool(body.get("demo"))
        email = DEMO_EMAIL if demo else str(body.get("email", "")).strip().lower()[:120]
        password = str(body.get("password", ""))
        if not demo:
            if "@" not in email:
                return 400, {"error": "Enter your work email."}, {}
            want_email, want_pw = os.environ.get("CERTUS_DEMO_EMAIL", "").lower(), os.environ.get("CERTUS_DEMO_PASSWORD", "")
            if want_pw and not (hmac.compare_digest(email, want_email) and hmac.compare_digest(password, want_pw)):
                return 401, {"error": "Wrong email or password."}, {}
        user = {**user_for("abhishek@certus.ai"), "email": DEMO_EMAIL} if demo else user_for(email)
        method = "demo workspace" if demo else "password" if not config()["demo_mode"] else "email (demo mode)"
        token = issue(user, method)
        store.log(user["actor"], "signed in", user["email"], f"{user['name']} · {ORG} · {method}")
        return 200, {"user": verify(token), "token": token}, {"Set-Cookie": cookie(token)}
    return 404, {"error": "not found"}, {}
