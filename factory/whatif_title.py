"""Display title of a what-if: what the Simulation Agent read the question as, else a deterministic cleanup of what
was typed (spacing, capital letter, a typo of a known what-if word). The typed text stays on the events as `asked`.

Applied when events are read (store.events), so older runs get the same titles as new ones and the recorded feed is
never rewritten."""
import difflib
import re

VOCAB = ["turbulence", "turbulent", "gust", "gusts", "sensor", "failure", "fails", "stuck", "vane", "stall", "sideslip",
         "disagree", "pilot", "cruise", "approach", "climb", "thrust", "meal", "carbs", "snack", "typo", "decimal",
         "bolus", "dose", "insulin", "extended", "child", "adult", "adolescent", "alarm"]


def clean(text):
    """'  what if   the vane fails ' -> 'What if the vane fails'; 'trublanceh' -> 'Turbulence'."""
    t = " ".join(str(text or "").split())
    if t and not any(k in t.lower() for k in VOCAB):
        fix = lambda m: (difflib.get_close_matches(m.group(0).lower(), VOCAB, 1, 0.7) or [m.group(0)])[0]  # noqa: E731
        t = re.sub(r"[A-Za-z]{4,}", fix, t)
    return t[:1].upper() + t[1:]


def title(asked, plan=""):
    """Title of a what-if asked as `asked`, given the Simulation Agent's plan message ("Read 'X' as Y and ...")."""
    m = re.match(r"Read ['\"‘“](.+?)['\"’”] as (.{2,60}?)(?: and |, |\. |\.?$)", plan or "")
    return clean(m.group(2)) if m else clean(asked)


def apply(evs):
    """Give each what-if run's events the display title; the typed text moves to `asked` when it differs."""
    runs = {}
    for e in evs:
        if e.get("wo"):
            runs[e["run"]] = None
        elif e["run"] not in runs and e.get("title"):
            runs[e["run"]] = {"asked": e["title"], "plan": ""}
        if runs.get(e["run"]) and e["agent"] == "simulation" and e["state"] == "done":
            runs[e["run"]]["plan"] = e["msg"]
    for e in evs:
        r = runs.get(e["run"])
        if not r:
            continue
        t = title(r["asked"], r["plan"])
        extra = {"asked": r["asked"]} if t != r["asked"] else {}
        if e.get("title"):
            e.update(title=t, **extra)
        if (e.get("world") or {}).get("question"):
            e["world"] = {**e["world"], "question": t, **extra}
    return evs
