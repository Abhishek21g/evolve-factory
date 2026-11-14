"""World model: diagnose why a simulated run failed, and the fix loop of a work order.

SIMULATION = the physics: sim/flight.py (737-class aircraft) and sim/world.py (simglucose patients) run the candidate's
real code in the loop and return one time series per run.
WORLD MODEL = this layer on top: scenarios go in (gate scenarios, what-ifs, fault injection), the simulation runs them,
and this module finds where a run left the safe envelope and diagnoses it from the trace and the code: which safety
requirement (SR) and hazard (H) is violated, at what time, through which causal chain, and which code lines are
responsible. The report goes back to the coding agent, and the loop re-runs until the world model passes.

Every fact here comes from code: simulation traces, safety.json and git. No LLM is involved.

  python3 factory/worldmodel.py WO-344        # the loop of a work order, as JSON
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory"))
import store  # noqa: E402

SOURCES = {"flight-controls": ("fcc.h", "fcc.c"), "insulin-pump": ("pump.h", "pump.c")}
VANE_NOISE = 0.16      # sim/flight.py adds two 0.08 deg sine terms of opposite sign to the vanes: split +- 0.16 deg
SEVERE_HYPO = 54       # sim/world.py SEVERE_HYPO (mg/dL)
EPS = 1e-6


def git_show(ref, path):
    p = subprocess.run(["git", "-C", ROOT, "show", f"{ref}:{path}"], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None


def defines(src):
    """#define NAME value -> {NAME: (value, line)}; value is a float when numeric, else the raw text."""
    out = {}
    for i, line in enumerate((src or "").splitlines(), 1):
        m = re.match(r"\s*#define\s+([A-Z_][A-Z0-9_]*)\s+([^\s/]+)", line)
        if m:
            try:
                out[m.group(1)] = (float(m.group(2)), i, m.group(2))
            except ValueError:
                out[m.group(1)] = (m.group(2), i, m.group(2))
    return out


def num(lim, name, default):
    v = lim.get(name, (default,))[0]
    return v if isinstance(v, float) else default


def changed_limits(base_h, cand_h, path):
    """Limits the candidate changed or added in its header, with the line they are on."""
    b, c = defines(base_h), defines(cand_h)
    lines = (cand_h or "").splitlines()
    out = []
    for name, (val, line, raw) in c.items():
        if name not in b or b[name][0] != val:
            out.append({"symbol": name, "base": b[name][2] if name in b else None, "cand": raw, "cand_value": val,
                        "file": path, "line": line, "text": lines[line - 1].strip()})
    return out


def limit_text(c, where=True):
    at = f" ({c['file']}:{c['line']})" if where else ""
    return (f"new limit {c['symbol']} = {c['cand']}" if c["base"] is None else f"{c['symbol']} {c['base']} → {c['cand']}") + at


def code_refs(src_c, symbols, path):
    """Lines of the .c file that read the given symbols, plus the lines that act on what those lines assign."""
    lines = (src_c or "").splitlines()
    refs, seen = [], set()

    def add(i, role):
        if i not in seen and 0 <= i < len(lines):
            seen.add(i)
            refs.append({"file": path, "line": i + 1, "text": re.sub(r"\s*/\*.*?\*/\s*$", "", lines[i]).strip(), "role": role})

    for i, line in enumerate(lines):
        hit = [s for s in symbols if re.search(rf"\b{s}\b", line)]
        if not hit or re.match(r"\s*(\*|/\*|//)", line):
            continue
        add(i, f"reads {', '.join(hit)}")
        m = re.match(r"\s*([\w>\-.]+)\s*=[^=]", line)
        var = m.group(1).split(">")[-1].split(".")[-1] if m else None
        for j in range(i + 1, len(lines)):
            if var and re.search(rf"\b{re.escape(var)}\b", lines[j]):
                add(j, f"acts on {var}")
                if re.match(r"\s*(if|else if)\b.*\)\s*$", lines[j]):
                    add(j + 1, f"acts on {var}")
    return sorted(refs, key=lambda r: r["line"])


def snippet(src, lines, ctx=2):
    """Numbered source lines around the given line numbers, for the code card."""
    all_ = (src or "").splitlines()
    keep = sorted({k for ln in lines for k in range(max(1, ln - ctx), min(len(all_), ln + ctx) + 1)})
    return [{"line": k, "text": all_[k - 1], "hot": k in lines} for k in keep]


def _first(xs, pred, start=0):
    return next((i for i in range(start, len(xs)) if pred(i)), None)


# ---------- flight controls: requirement monitors over the simulated flight ----------

def aircraft_monitors(run, sc, world, cert):
    """Check each simulation-observable safety requirement against one flight, with the certified limits (main's fcc.h).
    Returns (violations, facts)."""
    s, dt = run["series"], world["step_min"]
    aoa, trim, alt = s["aoa"], s["trim"], s["alt"]
    n = len(aoa)
    protect, release = num(cert, "AOA_PROTECT_DEG", 12.0), num(cert, "AOA_RELEASE_DEG", 10.0)
    dis, auth, rate = num(cert, "AOA_DISAGREE_DEG", 5.5), num(cert, "MAX_NOSE_DOWN_DEG", 2.5), num(cert, "TRIM_RATE_DEG_S", 0.5)
    stall = world.get("threshold", 15.0)
    split, stuck, ev = sc.get("split") or 0.0, sc.get("stuck"), sc.get("event_at", 5)
    agree = stuck is None and split + VANE_NOISE <= dis
    disagree_from = 0 if split - VANE_NOISE > dis else (int(ev / dt) if stuck is not None else None)
    t = lambda i: round(i * dt, 1)  # noqa: E731
    out = []
    i_prot = _first(aoa, lambda i: aoa[i] > protect)
    i_stall = _first(aoa, lambda i: aoa[i] > stall)
    i_peak = max(range(n), key=lambda i: aoa[i])
    loss_i = min(range(n), key=lambda i: alt[i])
    facts = {"protect": protect, "stall": stall, "disagree_cert": dis, "split": split, "stuck": stuck,
             "split_range": [round(max(0, split - VANE_NOISE), 2), round(split + VANE_NOISE, 2)] if split else None,
             "t_protect": t(i_prot) if i_prot is not None else None, "t_stall": t(i_stall) if i_stall is not None else None,
             "peak": aoa[i_peak], "t_peak": t(i_peak), "stall_s": round(sum(a > stall for a in aoa) * dt, 1),
             "trim_max": max(trim), "alt_loss_ft": max(0, -alt[loss_i]), "t_alt_loss": t(loss_i)}
    # SR-3: above the protect AoA with agreeing sources, protection must start trimming within 1 s (or already be at authority)
    if agree:
        k = int(1.0 / dt)
        i = _first(aoa, lambda i: aoa[i] > protect and trim[i] < auth - EPS and trim[min(i + k, n - 1)] <= trim[i] + EPS)
        if i is not None:
            held = sum(1 for j in range(i, n) if aoa[j] > protect and trim[j] <= EPS) * dt
            out.append({"req": "SR-3", "at": t(i), "evidence":
                        f"AoA {aoa[i]:.1f}° > {protect:g}° protect threshold with the vanes agreeing within {split + VANE_NOISE:.2f}° "
                        f"(<= {dis:g}°), but protection trim stayed {trim[i]:.1f}° (no nose-down for {held:.1f} s above {protect:g}°)"})
    i = _first(trim, lambda i: trim[i] > auth + EPS)
    if i is not None:
        out.append({"req": "SR-1", "at": t(i), "evidence": f"protection trim {trim[i]:.2f}° > {auth:g}° authority"})
    i = _first(trim[:-1], lambda i: abs(trim[i + 1] - trim[i]) > rate * dt + EPS)
    if i is not None:
        out.append({"req": "SR-5", "at": t(i), "evidence": f"trim moved {abs(trim[i + 1] - trim[i]) / dt:.2f}°/s > {rate:g}°/s"})
    if disagree_from is not None:
        i = _first(trim, lambda i: trim[i] > EPS, disagree_from)
        if i is not None:
            src = f"left vane failed at {stuck:g}°" if stuck is not None else f"vanes split {split:g}°"
            out.append({"req": "SR-2", "at": t(i), "evidence": f"nose-down trim {trim[i]:.2f}° while AoA data is invalid ({src}, > {dis:g}°)"})
    k = int((auth / rate + 1.0) / dt)
    i = _first(aoa, lambda i: i >= k and all(aoa[j] < release for j in range(i - k, i + 1)) and trim[i] > EPS)
    if i is not None:
        out.append({"req": "SR-4", "at": t(i), "evidence": f"trim still {trim[i]:.2f}° after {k * dt:.0f} s below {release:g}° AoA (latched)"})
    return out, facts


def aircraft_chain(sc, facts, viol, changed, refs, run, world):
    """Causal chain from the scenario through the code to the exceedance, as timed steps (all values from above)."""
    chain = []
    split, stuck = facts["split"], facts["stuck"]
    if split:
        lo, hi = facts["split_range"]
        chain.append({"t": 0.0, "kind": "scenario", "text": f"Sideslip splits the two AoA vanes by {split:g}° ({lo}-{hi}° with vane noise)"})
    if stuck is not None:
        chain.append({"t": sc.get("event_at", 5), "kind": "scenario", "text": f"Left AoA vane fails and reads {stuck:g}°"})
    if sc.get("gust"):
        chain.append({"t": 0.0, "kind": "scenario", "text": f"Vertical gusts up to {sc['gust']:g} m/s"})
    if sc.get("pull"):
        chain.append({"t": sc.get("event_at", 5), "kind": "scenario",
                      "text": f"Thrust to idle, pilot pulls toward {sc['pull']:g}° AoA" if sc.get("idle") else f"Pilot pulls toward {sc['pull']:g}° AoA"})
    dis = next((c for c in changed if c["symbol"] == "AOA_DISAGREE_DEG"), None)
    if dis and split and isinstance(dis["cand_value"], float) and facts["split_range"][0] > dis["cand_value"]:
        chain.append({"t": 0.0, "kind": "code", "text": f"Disagree {facts['split_range'][0]}-{facts['split_range'][1]}° > the candidate's "
                      f"AOA_DISAGREE_DEG {dis['cand']}° (main: {dis['base']}°, {dis['file']}:{dis['line']})"})
        valid = next((r for r in refs if "AOA_DISAGREE_DEG" in r["role"]), None)
        act = next((r for r in refs if r["role"].startswith("acts on") and "active" in r["text"]), None)
        if valid:
            chain.append({"t": 0.0, "kind": "code", "text": f"{valid['file']}:{valid['line']} marks the AoA data invalid (aoa_valid = 0)"})
        if act:
            chain.append({"t": 0.0, "kind": "code", "text": f"{act['file']}:{act['line']} `{act['text']}`: stall protection inhibited"})
    else:
        for c in changed:
            chain.append({"t": 0.0, "kind": "code", "text": limit_text(c)})
    if facts["t_protect"] is not None:
        chain.append({"t": facts["t_protect"], "kind": "sim", "text": f"AoA passes the {facts['protect']:g}° protect threshold; protection trim "
                      + ("stays 0.0°" if facts["trim_max"] <= EPS else f"reaches {facts['trim_max']:.1f}° max")})
    if facts["t_stall"] is not None:
        chain.append({"t": facts["t_stall"], "kind": "sim", "text": f"AoA exceeds the {facts['stall']:g}° stall AoA"})
        chain.append({"t": facts["t_peak"], "kind": "sim", "text": f"Peak AoA {facts['peak']:.1f}°; above stall for {facts['stall_s']:.1f} s"})
    limit = sc.get("max_alt_loss_ft")
    if limit is not None and facts["alt_loss_ft"] > limit:
        chain.append({"t": facts["t_alt_loss"], "kind": "sim", "text": f"Altitude loss {facts['alt_loss_ft']:.0f} ft > {limit:g} ft limit"})
    for v in viol:
        chain.append({"t": v["at"], "kind": "violation", "text": f"{v['req']} violated: {v['evidence']}"})
    return sorted(chain, key=lambda c: (c["t"], ["scenario", "code", "sim", "violation"].index(c["kind"])))


def aircraft_moment(run, sc, world, facts):
    if facts["t_stall"] is not None:
        return {"t": facts["t_stall"], "label": f"stall: AoA > {facts['stall']:g}°", "value": facts["peak"]}
    return {"t": facts["t_alt_loss"], "label": f"altitude loss {facts['alt_loss_ft']:.0f} ft", "value": facts["alt_loss_ft"]}


def aircraft_headline(facts, viol, changed):
    bits = []
    dis = next((c for c in changed if c["symbol"] == "AOA_DISAGREE_DEG"), None)
    if dis and facts["split"] and isinstance(dis["cand_value"], float) and facts["split_range"][0] > dis["cand_value"]:
        bits += [f"vane disagree {facts['split']:g}° > {dis['cand']}° threshold", "stall protection inhibited"]
    elif viol:
        bits.append(f"{viol[0]['req']} violated at t={viol[0]['at']:g} s")
    if facts["t_stall"] is not None:
        bits.append(f"AoA exceeded stall at t={facts['t_stall']:g} s (peak {facts['peak']:.1f}°)")
    elif facts["alt_loss_ft"]:
        bits.append(f"lost {facts['alt_loss_ft']:.0f} ft")
    return " → ".join(bits)


# ---------- insulin pump: requirement monitors over the simulated patient ----------

def _note_units(note):
    m = re.findall(r"([\d.]+) U", note or "")
    return float(m[0]) if m else None


def pump_monitors(run, sc, world, cert):
    dt = world["step_min"]
    trace, ins = run["trace"], run.get("insulin") or []
    meal = sc.get("meal_at", world.get("meal_at", 30))
    max_bolus, max_daily = num(cert, "MAX_BOLUS_U", 10.0), num(cert, "MAX_DAILY_U", 60.0)
    min_bg = num(cert, "MIN_BG_FOR_BOLUS", 70.0)
    ext_total = max_bolus * cert["MAX_EXT_MINUTES"][0] / 60 if isinstance(cert.get("MAX_EXT_MINUTES", (None,))[0], float) else None
    note, out = run.get("note", ""), []
    given = run.get("bolus_u", _note_units(note) or 0.0)
    hour = max((sum(ins[i:i + int(60 / dt)]) for i in range(len(ins))), default=0.0)
    if "extended" in note:
        if ext_total is not None and given > ext_total + EPS:
            out.append({"req": "SR-1", "at": meal, "evidence": f"extended delivery {given:.1f} U > certified {ext_total:g} U adult total (MAX_EXTENDED_U)"})
        elif hour > max_bolus + EPS:
            out.append({"req": "SR-1", "at": meal, "evidence": f"{hour:.1f} U delivered in one hour > {max_bolus:g} U"})
    elif "no insulin" not in note and (_note_units(note.split("re-entered")[-1]) or given) > max_bolus + EPS:
        out.append({"req": "SR-1", "at": meal, "evidence": f"single bolus {given:.1f} U delivered > {max_bolus:g} U limit"})
    if given > max_daily + EPS:
        out.append({"req": "SR-2", "at": meal, "evidence": f"{given:.1f} U delivered > {max_daily:g} U daily limit"})
    bg_meal = trace[min(len(trace) - 1, int(meal / dt))] if trace else 999
    if given > EPS and bg_meal < min_bg:
        out.append({"req": "SR-3", "at": meal, "evidence": f"bolus given at BG {bg_meal} mg/dL < {min_bg:g} mg/dL"})
    i_low = _first(trace, lambda i: trace[i] < SEVERE_HYPO)
    facts = {"meal_at": meal, "given_u": round(given, 2), "base_u": run.get("base_bolus_u"), "note": note, "base_note": run.get("base_note"),
             "t_low": i_low * dt if i_low is not None else None, "min": run["min"], "base_min": run.get("base_min"),
             "nadir_at": run.get("nadir_at", trace.index(min(trace)) * dt if trace else None)}
    return out, facts


def pump_chain(sc, facts, viol, changed, refs, run, world):
    chain = [{"t": facts["meal_at"], "kind": "scenario", "text": f"{sc.get('label') or sc.get('id')}: meal and bolus request"}]
    for c in changed:
        chain.append({"t": facts["meal_at"], "kind": "code", "text": limit_text(c)})
    main = f" (main: {facts['base_note']})" if facts.get("base_note") else ""
    chain.append({"t": facts["meal_at"], "kind": "sim", "text": f"pump.c decides: {facts['note']}{main}"})
    if facts["t_low"] is not None:
        chain.append({"t": facts["t_low"], "kind": "sim", "text": f"Blood glucose falls below {SEVERE_HYPO} mg/dL"})
    chain.append({"t": facts["nadir_at"], "kind": "sim", "text": f"Nadir {facts['min']} mg/dL" + (f" (main: {facts['base_min']} mg/dL)" if facts.get("base_min") is not None else "")})
    for v in viol:
        chain.append({"t": v["at"], "kind": "violation", "text": f"{v['req']} violated: {v['evidence']}"})
    return sorted(chain, key=lambda c: (c["t"], ["scenario", "code", "sim", "violation"].index(c["kind"])))


def pump_moment(run, sc, world, facts):
    t = facts["t_low"] if facts["t_low"] is not None else facts["nadir_at"]
    return {"t": t, "label": f"severe hypo < {SEVERE_HYPO} mg/dL", "value": facts["min"]}


def pump_headline(facts, viol, changed):
    ext = [c for c in changed if "EXT" in c["symbol"]] if "extended" in facts["note"] else []
    bits = [f"{c['symbol']} changed from {c['base']} to {c['cand']}" if c["base"] is not None else f"new limit {c['symbol']} = {c['cand']}"
            for c in (ext or changed)[:1]]
    bits.append(f"pump.c {facts['note']}")
    if facts["t_low"] is not None:
        bits.append(f"BG < {SEVERE_HYPO} at {facts['t_low'] / 60:.1f} h (nadir {facts['min']})")
    return " → ".join(bits)


DEVICE = {"flight-controls": (aircraft_monitors, aircraft_chain, aircraft_moment, aircraft_headline),
          "insulin-pump": (pump_monitors, pump_chain, pump_moment, pump_headline)}


# ---------- diagnosis of one world-model result ----------

def diagnose(world, spec, dev_id, repo, base_src=None, cand_src=None, gate=None):
    """Structured failure report for a world-model result. base_src / cand_src: {"h": text, "c": text} of main and of the
    candidate (None when unknown). gate: the gate result of the same attempt (requirement unit tests)."""
    monitors, chain_of, moment_of, headline_of = DEVICE[dev_id]
    h_name, c_name = SOURCES[dev_id]
    whatif = world.get("base") == "none"
    rs = world.get("results", [])
    bad = [r for r in rs if (r["hypo"] if whatif else r.get("new_hypo"))]
    if not bad:
        return None
    base_src, cand_src = base_src or {}, cand_src or {}
    cert = defines(base_src.get("h") or cand_src.get("h"))
    changed = changed_limits(base_src.get("h"), cand_src.get("h"), f"{repo}/{h_name}") if base_src.get("h") and cand_src.get("h") else []
    refs = code_refs(cand_src.get("c"), [c["symbol"] for c in changed], f"{repo}/{c_name}")
    reqs = {r["id"]: r for r in spec["requirements"]}
    haz = {h["id"]: h for h in spec["hazards"]}
    scen = {s["id"]: s for s in world.get("scenarios") or []}
    out_sc = []
    for sid in dict.fromkeys(r["scenario"] for r in bad):
        runs = [r for r in bad if r["scenario"] == sid]
        sc = scen.get(sid, {"id": sid})
        r0 = runs[0]
        viol, facts = monitors(r0, sc, world, cert)
        out_sc.append({"scenario": sid, "label": sc.get("label", sid), "failing": len(runs),
                       "total": sum(r["scenario"] == sid for r in rs), "run": r0["patient"], "runs": [r["patient"] for r in runs],
                       "moment": moment_of(r0, sc, world, facts), "facts": facts, "violations": viol,
                       "chain": chain_of(sc, facts, viol, changed, refs, r0, world), "headline": headline_of(facts, viol, changed)})
    failed_tests = [g["id"] for g in (gate or {}).get("rows", []) if g.get("result") != "PASS"]
    violated = list(dict.fromkeys([v["req"] for s in out_sc for v in s["violations"]] + failed_tests))
    responsible = [r["id"] for r in spec["requirements"] if set(r.get("symbols", [])) & {c["symbol"] for c in changed}]
    hazards = list(dict.fromkeys(h for rid in violated for h in reqs.get(rid, {}).get("hazards", [])))
    envelope = ["H-2"] if dev_id == "flight-controls" and any(s["facts"].get("t_stall") is not None for s in out_sc) else \
        ["H-1", "H-3"] if dev_id == "insulin-pump" else []
    hazards = list(dict.fromkeys(hazards + [h for h in envelope if h in haz]))
    code_files = {}
    for c in changed:
        code_files.setdefault(c["file"], {"src": cand_src.get("h"), "lines": []})["lines"].append(c["line"])
    for r in refs:
        code_files.setdefault(r["file"], {"src": cand_src.get("c"), "lines": []})["lines"].append(r["line"])
    rep = {"verdict": world.get("verdict"), "kind": world.get("kind", "pump"), "failing": len(bad), "total": len(rs),
           "scenarios": out_sc, "requirements": [{"id": rid, "text": reqs[rid]["text"], "dal": reqs[rid].get("dal"),
                                                  "objectives": reqs[rid].get("objectives", []), "hazards": reqs[rid]["hazards"],
                                                  "monitor": any(v["req"] == rid for s in out_sc for v in s["violations"]),
                                                  "unit_test": "FAIL" if rid in failed_tests else ("PASS" if gate else None)}
                                                 for rid in violated if rid in reqs],
           "responsible": responsible, "uncovered": not violated,
           "hazards": [{"id": h, "title": haz[h]["title"], "severity": haz[h].get("severity"), "dal": haz[h].get("dal")} for h in hazards],
           "changed": changed, "refs": refs,
           "code": [{"file": f, "snippet": snippet(v["src"], v["lines"])} for f, v in code_files.items() if v["src"]]}
    rep["headline"] = out_sc[0]["headline"]
    rep["explain"] = explain(rep, dev_id)
    rep["handoff"] = handoff(rep)
    return rep


def explain(rep, dev_id):
    """Plain-English explanation, filled from the deterministic report (template, not an LLM)."""
    s = rep["scenarios"][0]
    subj = "simulated flights" if dev_id == "flight-controls" else "simulated patients"
    hz = ", ".join(f"{h['id']} {h['title']}" for h in rep["hazards"])
    out = f"{rep['failing']} of {rep['total']} {subj} left the safe envelope in \"{s['label']}\": {s['headline']}. "
    req = rep["requirements"][0] if rep["requirements"] else None
    if req:
        return out + f"That violates {req['id']} ({req['text']})" + (f" and leads to {hz}." if hz else ".")
    return out + f"Every requirement test passed: no safety requirement covers this yet ({hz or 'unlisted hazard'}). It needs a new one."


def handoff(rep):
    """The structured failure report the coding agent gets on its next attempt."""
    md = ["## World model diagnosis (deterministic: simulation trace + code + safety.json)", "",
          f"Failing: {rep['failing']} of {rep['total']} simulated runs. {rep['headline']}.", ""]
    for r in rep["requirements"]:
        md.append(f"- Violated {r['id']} ({r['text']}); hazards {', '.join(r['hazards'])}"
                  + (f"; objectives {', '.join(r['objectives'])}" if r["objectives"] else "")
                  + (f"; unit test {r['unit_test']}" if r["unit_test"] else ""))
    for s in rep["scenarios"]:
        md += ["", f"### {s['label']} ({s['failing']}/{s['total']} runs, e.g. {s['run']})"]
        md += [f"- t={c['t']:g}: {c['text']}" for c in s["chain"]]
    if rep["changed"]:
        md += ["", "Responsible code (certified limits changed vs main):"]
        md += [f"- {c['file']}:{c['line']} `{c['text']}` (main: {c['base']})" for c in rep["changed"]]
        md += [f"- {r['file']}:{r['line']} `{r['text']}` ({r['role']})" for r in rep["refs"]]
    md += ["", "Fix it without changing any certified limit; keep every requirement above satisfied."]
    return "\n".join(md)


# ---------- the loop of a work order: attempt -> simulation -> diagnosis -> fix -> re-simulation ----------

def _run_series(world, r):
    """What the loop chart draws for one run."""
    if not r:
        return None
    out = {"run": r["patient"], "scenario": r["scenario"], "dt": world["step_min"], "trace": r["trace"],
           "base_trace": None if world.get("base") == "none" else r.get("base_trace"), "note": r["note"], "bad": r.get("new_hypo") or (world.get("base") == "none" and r["hypo"])}
    if r.get("series"):
        out["trim"] = r["series"].get("trim")
    if r.get("insulin"):
        out["insulin"] = r["insulin"]
    return out


def loop(wo):
    """Every attempt of the work order's latest run, from the event feed and git: commit, world-model verdict,
    requirement tests, diagnosis of a block, the fix that followed, and the re-simulation."""
    d = store._load()
    w = next((w for w in d["work_orders"] if w["id"] == wo), None)
    evs = [e for e in store.events() if e.get("wo") == wo]
    if not w or not evs:
        return None
    dev = store.device(w["project"])
    repo, (h_name, c_name) = dev["repo"], SOURCES[dev["id"]]
    spec = json.load(open(os.path.join(ROOT, repo, "safety.json")))
    last = evs[-1]["run"]
    evs = [e for e in evs if e["run"] == last]
    attempts, cur = [], None
    for e in evs:
        if e["agent"] == "gate" and e["state"] == "working":
            cur = {"n": len(attempts) + 1, "t": e["t"], "world": None, "gate": None}
            attempts.append(cur)
        elif cur is not None and e.get("world"):
            cur["world"] = e["world"]
        elif cur is not None and e["agent"] == "gate" and e.get("gate"):
            cur["gate"] = e["gate"]
    commits = sorted(store.git_changes(wo), key=lambda c: int(c["ts"]))
    by_n = {int(m.group(1)): c["sha"] for c in commits if (m := re.search(r"\(attempt (\d+)\)", c["subject"]))}
    shas = [by_n.get(a["n"]) or (commits[a["n"] - 1]["sha"] if a["n"] <= len(commits) else None) for a in attempts]
    first = next((s for s in shas if s), None)
    base_ref = f"{first}~1" if first else "HEAD"
    src = lambda ref: {"h": git_show(ref, f"{repo}/{h_name}"), "c": git_show(ref, f"{repo}/{c_name}")} if ref else {}  # noqa: E731
    base = src(base_ref)
    out, prev, featured = [], None, None
    for a, sha in zip(attempts, shas):
        world = a["world"] or {}
        cand = src(sha)
        diag = diagnose(world, spec, dev["id"], repo, base, cand, a["gate"]) if world else None
        if diag:  # draw this attempt's own failure; a passing attempt re-flies the last failure
            featured = (diag["scenarios"][0]["scenario"], diag["scenarios"][0]["run"])
        pick = None
        if world and featured:
            pick = next((r for r in world["results"] if (r["scenario"], r["patient"]) == featured), None)
        step = {"n": a["n"], "commit": sha, "world_verdict": world.get("verdict"), "gate_verdict": (a["gate"] or {}).get("verdict"),
                "tests": [{"id": g["id"], "result": g["result"]} for g in (a["gate"] or {}).get("rows", [])],
                "failing": sum(bool(r.get("new_hypo")) for r in world.get("results", [])), "total": len(world.get("results", [])),
                "diagnosis": diag, "series": _run_series(world, pick)}
        if prev is not None and sha and prev["commit"]:
            step["fix"] = {"changed": changed_limits(git_show(prev["commit"], f"{repo}/{h_name}"), cand.get("h"), f"{repo}/{h_name}"),
                           "diff": subprocess.run(["git", "-C", ROOT, "diff", prev["commit"], sha, "--", repo], capture_output=True,
                                                  text=True).stdout[:8000]}
        if pick and not diag and featured:
            step["resim"] = {"scenario": featured[0], "run": featured[1], "note": pick["note"], "inside": not pick["hypo"],
                             "peak": pick.get("peak_aoa", pick.get("min"))}
        out.append(step)
        prev = step
    return {"wo": wo, "title": w["title"], "project": w["project"], "device": dev["id"], "repo": repo,
            "axis": next((a["world"].get("axis") for a in attempts if a["world"]), None),
            "threshold": next((a["world"].get("threshold") for a in attempts if a["world"]), None),
            "scenarios": next((a["world"].get("scenarios") for a in attempts if a["world"]), None),
            "replay": next((e.get("replay") for e in evs if e.get("replay")), None),
            "attempts": out, "final": out[-1]["world_verdict"] if out else None}


if __name__ == "__main__":
    json.dump(loop(sys.argv[1]), sys.stdout, indent=1)
