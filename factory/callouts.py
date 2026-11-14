"""Hear the failure: cockpit callouts and pump alarms derived from a simulation run, deterministically (code, no LLM).

  .venv/bin/python factory/callouts.py beats   # web/public/callouts.json: the recorded beats (hosted site + offline)
  .venv/bin/python factory/callouts.py audio   # synthesize missing clips into web/public/audio/ (ElevenLabs, once)

Every event comes from the run's own time series and the code's own outputs:
  flight controls (sim/flight.py rows, 0.5 s samples)
    AOA DISAGREE   when the candidate's fcc_aoa_disagree() first reported the alert (alert_at); if the code has no alert
                   but the scenario splits the vanes beyond the alert threshold, a silent marker: the crew was not told (H-3)
    NOSE DOWN TRIM first sample with stall-protection trim commanded (trim > 0)
    STICK SHAKER   true AoA above the stall-warning AoA (repeats while it stays there)
    STALL          true AoA above the stall AoA (repeats while stalled)
  insulin pump (sim/world.py rows, 5 min samples)
    BOLUS LIMIT    the pump rejected the typed dose at the meal (the pump's own decision, from the run note)
    LOW / URGENT LOW  glucose below 70 / 54 mg/dL
The sim has no autopilot model, so there is no autopilot-disconnect callout.
Audio is a fixed catalog of short clips, generated once and committed, so any run (recorded or live) plays at once.
"""
import json
import os
import re
import sys

import elevenlabs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "web", "public", "audio")
BEATS = os.path.join(ROOT, "web", "public", "callouts.json")
STALL_DEG, STALL_WARN_DEG, ALERT_DEG = 15.0, 14.0, 5.0   # stall, stick-shaker margin, WO-344's AOA DISAGREE alert threshold
LOW, URGENT_LOW = 70, 54
PLAY_S = {"flight-controls": 20, "insulin-pump": 24}       # playback length of one run (aircraft 60 s at 3x, pump 12 h)

# id: (kind, text or sound prompt, voice role). Short, so the whole catalog stays well under 1 MB.
CLIPS = {
    "aoa_disagree": ("voice", "A O A disagree.", "cockpit"),
    "nose_down": ("voice", "Nose down trim.", "cockpit"),
    "stall": ("voice", "Stall. Stall.", "cockpit"),
    "master_caution": ("sfx", "Airliner cockpit master caution alert, a single short electronic chime, no voice", 1.0),
    "stick_shaker": ("sfx", "Airliner stick shaker stall warning, loud rapid mechanical rattling vibration of the control column, no voice", 2.0),
    "pump_alarm": ("sfx", "Medical insulin pump alarm, three short high-pitched beeps, no voice", 1.0),
    "bolus_limit": ("voice", "Bolus exceeds limit. Confirm dose.", "pump"),
    "low_glucose": ("voice", "Low glucose.", "pump"),
    "urgent_low": ("voice", "Urgent low glucose.", "pump"),
}


def _ev(t, clip, label, detail, tone, extra=None):
    return {"t": round(t, 2), "clip": clip, "label": label, "detail": detail, "tone": tone, **(extra or {})}


def _crossings(xs, dt, pred, every):
    """Times a predicate becomes true, repeated every `every` seconds while it stays true."""
    out, last = [], None
    for i, x in enumerate(xs):
        t = i * dt
        if pred(x) and (last is None or t - last >= every):
            out.append(t)
            last = t
        elif not pred(x):
            last = None
    return out


def aircraft_events(r, sc, dt):
    s = r["series"]
    aoa, trim = s["aoa"], s["trim"]
    ev = []
    if r.get("alert_at") is not None:
        ev.append(_ev(r["alert_at"], "master_caution", "", "", "warn"))
        ev.append(_ev(r["alert_at"] + 0.4, "aoa_disagree", "AOA DISAGREE", "fcc_aoa_disagree() alerted the crew", "warn"))
    else:
        split = sc.get("split") or 0.0
        if split > ALERT_DEG or sc.get("stuck") is not None:
            t0 = 0.0 if split > ALERT_DEG else sc.get("event_at", 0)
            what = f"vanes {split:g}° apart" if split > ALERT_DEG else f"left vane stuck at {sc['stuck']:g}°"
            ev.append(_ev(t0, None, "No AOA DISAGREE", f"{what}, no crew alert on this software (H-3)", "bad"))
    i = next((i for i, x in enumerate(trim) if x > 0.01), None)
    if i is not None:
        ev.append(_ev(i * dt, "nose_down", "NOSE DOWN TRIM", f"stall protection trims {max(trim):.1f}° nose down", "ok"))
    for t in _crossings(aoa, dt, lambda a: a > STALL_WARN_DEG, 6.0):
        ev.append(_ev(t, "stick_shaker", "STICK SHAKER", f"AoA above {STALL_WARN_DEG:g}° (stall warning)", "warn"))
    for t in _crossings(aoa, dt, lambda a: a > STALL_DEG, 8.0):
        ev.append(_ev(t, "stall", "STALL", f"AoA above {STALL_DEG:g}°, peak {max(aoa):.1f}°", "bad"))
    return sorted(ev, key=lambda e: e["t"])


def pump_events(r, sc, dt_min, meal_at):
    ev, note = [], r["note"]
    t_meal = sc.get("meal_at", meal_at) * 60
    if "rejected" in note:
        ev.append(_ev(t_meal, "pump_alarm", "", "", "warn"))
        ev.append(_ev(t_meal + 60, "bolus_limit", "BOLUS EXCEEDS LIMIT", note, "warn"))
    elif m := re.match(r"typo ([\d.]+) U delivered", note):
        ev.append(_ev(t_meal, None, "No alarm", f"typed {m.group(1)} U (10x the intended dose), the pump delivered it", "bad"))
    trace = r["trace"]
    i = next((i for i, g in enumerate(trace) if g < LOW), None)
    if i is not None:
        ev.append(_ev(i * dt_min * 60, "low_glucose", "LOW GLUCOSE", f"{trace[i]} mg/dL", "warn"))
    i = next((i for i, g in enumerate(trace) if g < URGENT_LOW), None)
    if i is not None:
        ev.append(_ev(i * dt_min * 60, "urgent_low", "URGENT LOW", f"{trace[i]} mg/dL (severe hypoglycemia)", "bad"))
    return sorted(ev, key=lambda e: e["t"])


def timeline(world, key, verdict=None):
    """One run of a world-model result (scenario, patient/config) as a playable timeline."""
    r = next((x for x in world["results"] if (x["scenario"], x["patient"]) == key), None)
    if r is None:
        return None
    sc = next((s for s in world.get("scenarios") or [] if s["id"] == key[0]), {"id": key[0]})
    air = world.get("kind") == "aircraft"
    dt = world["step_min"]
    if air:
        series = {"value": r["series"]["aoa"], "strip": r["series"]["trim"], "dt": dt}
        events = aircraft_events(r, sc, dt)
        lines = [[STALL_DEG, "stall"], [STALL_WARN_DEG, "stick shaker"]]
        unit, strip = "° AoA", "protection trim (° nose down)"
    else:
        series = {"value": r["trace"], "strip": r.get("insulin"), "dt": dt * 60}
        events = pump_events(r, sc, dt, world.get("meal_at", 30))
        lines = [[URGENT_LOW, "54 severe"], [LOW, "70 low"]]
        unit, strip = "mg/dL", "insulin pump.c delivered (U / 5 min)"
    return {"device": "flight-controls" if air else "insulin-pump", "verdict": verdict or world["verdict"],
            "scenario": key[0], "label": sc.get("label", key[0]), "run": key[1], "note": r["note"], "bad": bool(r["hypo"]),
            "unit": unit, "strip_label": strip, "lines": lines, "series": series, "events": events,
            "play_s": PLAY_S["flight-controls" if air else "insulin-pump"]}


def featured(world):
    """The run the world-model loop features: the first run that left the envelope (else the first run)."""
    whatif = world.get("base") == "none"
    rs = world["results"]
    bad = [r for r in rs if (r["hypo"] if whatif else r.get("new_hypo"))]
    r = bad[0] if bad else rs[0]
    return r["scenario"], r["patient"]


def beat(worlds, wo=None, title=None):
    """Before/after of a work order: the first blocked attempt and the final attempt, on the same simulated run."""
    worlds = [w for w in worlds if w and w.get("results")]
    if not worlds:
        return None
    blocked = next((w for w in worlds if w["verdict"] == "BLOCKED"), None)
    last = worlds[-1]
    if blocked is None:
        return {"wo": wo, "title": title, "before": None, "after": timeline(last, featured(last))}
    key = featured(blocked)
    return {"wo": wo, "title": title, "before": timeline(blocked, key),
            "after": timeline(last, key) if last is not blocked else None}


def whatif(world, question=None):
    return {"wo": None, "title": question or world.get("question"), "before": None, "after": timeline(world, featured(world))}


# ---------- live (factory server) ----------

def for_wo(evs, wo):
    """Before/after of a work order's latest run, from the event feed."""
    mine = [e for e in evs if e.get("wo") == wo]
    if not mine:
        return None
    last = mine[-1]["run"]
    worlds = [e["world"] for e in mine if e["run"] == last and e.get("world")]
    return beat(worlds, wo, next((e.get("title") for e in mine if e.get("title")), None))


def latest_whatif(evs):
    e = next((e for e in reversed(evs) if (e.get("world") or {}).get("base") == "none"), None)
    return whatif(e["world"]) if e else None


# ---------- recorded beats (hosted site) ----------

def _recorded(path):
    evs = [json.loads(l) for l in open(os.path.join(ROOT, path)) if l.strip()]
    return evs


def recorded():
    out = {}
    for dev, build, wi in (("flight-controls", "demo/replay/aircraft/build.jsonl", "demo/replay/aircraft/whatif.jsonl"),
                           ("insulin-pump", "demo/replay/build.jsonl", "demo/replay/whatif.jsonl")):
        b = _recorded(build)
        w = next((e["world"] for e in _recorded(wi) if e.get("world")), None)
        title = b[0].get("title", "").split("\n")[0]
        out[dev] = {"build": beat([e["world"] for e in b if e.get("world")], b[0].get("wo"), title),
                    "whatif": whatif(w) if w else None}
    return out


def clips_present():
    return sorted(c for c in CLIPS if os.path.exists(os.path.join(AUDIO, f"{c}.mp3")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "beats"
    if cmd == "beats":
        json.dump(recorded(), open(BEATS, "w"), separators=(",", ":"))
        print(f"wrote {os.path.relpath(BEATS, ROOT)} ({os.path.getsize(BEATS) // 1024} KB)")
    elif cmd == "audio":
        elevenlabs.load_env()
        os.makedirs(AUDIO, exist_ok=True)
        for cid, (kind, text, arg) in CLIPS.items():
            p = os.path.join(AUDIO, f"{cid}.mp3")
            if os.path.exists(p) and "--force" not in sys.argv:
                continue
            data = elevenlabs.tts(text, elevenlabs.VOICES[arg]) if kind == "voice" else elevenlabs.sfx(text, arg)
            open(p, "wb").write(data)
            print(f"{cid}: {len(data) // 1024} KB")
        print(f"audio: {sum(os.path.getsize(os.path.join(AUDIO, f)) for f in os.listdir(AUDIO)) // 1024} KB total")
    else:
        sys.exit("usage: callouts.py beats|audio [--force]")
