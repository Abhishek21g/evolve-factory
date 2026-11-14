"""The Certus safety hotline: an ElevenLabs Agents (Conversational AI) agent with one client tool, create_incident.

  .venv/bin/python factory/hotline.py setup                 # create (or update) the tool and the agent; ids -> demo/hotline/agent.json
  .venv/bin/python factory/hotline.py call [--port 8790]    # a real conversation with the agent in text mode, a scripted caller;
                                                            # create_incident goes to the local factory server; then the recorded
                                                            # sample call (transcript + audio) for the hosted site is written
In the app the browser runs the call (@elevenlabs/client, WebRTC) and forwards create_incident to POST /api/incidents.
A client tool needs no public URL, so live calls work from a laptop. Phone calls (Twilio) are documented in docs/HOTLINE.md.
"""
import argparse
import json
import os
import sys
import time

import requests
import websocket

import elevenlabs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT_FILE = os.path.join(ROOT, "demo", "hotline", "agent.json")
SAMPLE = os.path.join(ROOT, "web", "public", "hotline")
LLM = "claude-haiku-4-5"

PROMPT = """You are the Certus Safety Hotline, the voice line where pilots, engineers, clinicians and patients report safety
incidents with safety-critical software built in the Certus Factory. Projects: "Boeing Flight Controls" (737-class stall
protection, angle-of-attack sensors, stabilizer trim) and "Insulin Pump Firmware" (bolus limits, dosing).

Be calm, brief and precise, like an aviation safety officer. One question at a time. Collect:
1. project (which system),
2. what happened (the event, in the caller's words; ask one follow-up if it is vague),
3. when (date/time or flight phase),
4. severity as the caller judges it (catastrophic, hazardous, major, minor, or no effect) and whether anyone was hurt,
5. context: for aircraft the type, weight/CG, phase of flight, alerts seen; for the pump the patient, dose and glucose.
Skip anything the caller already said. Then read back a one-sentence summary and ask the caller to confirm.
Only after the caller confirms, call create_incident exactly once. Then tell the caller the incident id, the work order id
and the hazard it was traced to, exactly as the tool returned them, thank them, and end the call.
Never give flight or medical advice; for an emergency, tell them to contact ATC or emergency services."""

FIRST = "Certus safety hotline. I'm recording a safety report. Which system is this about?"

TOOL = {
    "type": "client", "name": "create_incident", "expects_response": True, "response_timeout_secs": 20,
    "description": "File the confirmed incident report: creates a draft work order on the project, writes it to the factory's "
                   "memory, and traces it to the most likely hazard. Call once, only after the caller confirmed the summary.",
    "parameters": {"type": "object", "required": ["project", "what_happened", "summary"], "properties": {
        "project": {"type": "string", "description": "System the report is about, e.g. Boeing Flight Controls or Insulin Pump Firmware"},
        "what_happened": {"type": "string", "description": "The event in the caller's words, with the alerts and effects they reported"},
        "when": {"type": "string", "description": "When it happened (date/time or phase of flight/therapy)"},
        "severity": {"type": "string", "description": "Caller's severity: catastrophic, hazardous, major, minor or no effect; injuries"},
        "context": {"type": "string", "description": "Aircraft type, weight/CG, phase, alerts; or patient, dose, glucose"},
        "caller": {"type": "string", "description": "Caller name and role, if given"},
        "summary": {"type": "string", "description": "The one-sentence summary the caller confirmed"},
    }},
}


def agent_body(tool_id):
    return {
        "name": "Certus Safety Hotline",
        "tags": ["certus", "evolve-hackathon"],
        "conversation_config": {
            "agent": {"first_message": FIRST, "language": "en",
                      "prompt": {"prompt": PROMPT, "llm": LLM, "temperature": 0.2, "tool_ids": [tool_id]}},
            "tts": {"voice_id": elevenlabs.VOICES["agent"]},
        },
        "platform_settings": {
            "auth": {"enable_auth": True},  # the browser starts calls with a token from the factory server; the key stays there
            "overrides": {"conversation_config_override": {"conversation": {"text_only": True}}},  # the text-mode test caller
        },
    }


def setup():
    cfg = json.load(open(AGENT_FILE)) if os.path.exists(AGENT_FILE) else {}
    if cfg.get("tool_id"):
        elevenlabs.update_tool(cfg["tool_id"], TOOL)
    else:
        cfg["tool_id"] = elevenlabs.create_tool(TOOL)
    if cfg.get("agent_id"):
        elevenlabs.update_agent(cfg["agent_id"], agent_body(cfg["tool_id"]))
    else:
        cfg["agent_id"] = elevenlabs.create_agent(agent_body(cfg["tool_id"]))
    cfg.update({"name": "Certus Safety Hotline", "llm": LLM, "voice_id": elevenlabs.VOICES["agent"], "tool": TOOL["name"]})
    os.makedirs(os.path.dirname(AGENT_FILE), exist_ok=True)
    json.dump(cfg, open(AGENT_FILE, "w"), indent=1)
    print(f"agent {cfg['agent_id']} (tool {cfg['tool_id']})")
    return cfg


def agent_id():
    return json.load(open(AGENT_FILE))["agent_id"] if os.path.exists(AGENT_FILE) else None


def status():
    return "connected" if elevenlabs.key() and agent_id() else "no agent" if elevenlabs.key() else "missing key"


CALLER = [  # a line captain reporting the sideslip event the world model reproduced
    "Hi, this is Captain Dana Reyes, I fly the 737 on the line. I want to report a problem with the Boeing flight controls.",
    "On approach this morning we flew through a gusty crosswind with some sideslip. The two angle of attack vanes disagreed by "
    "about five degrees and we got the AOA DISAGREE alert, but the stall protection did nothing. We got the stick shaker close "
    "to the stall, I recovered by hand and we lost about five hundred feet.",
    "Around seven forty this morning, on the approach into Denver. I'd call it hazardous. Nobody was hurt.",
    "It was a 737-800, about 66 tonnes with an aft CG, flaps up, thrust at idle, and the autopilot was off.",
    "Yes, that's correct. Please file it.",
]


def call(port):
    """A real conversation with the hotline agent over its WebSocket, in text mode, with a scripted caller."""
    url = elevenlabs.signed_url(agent_id())
    ws = websocket.create_connection(url, timeout=60)
    ws.send(json.dumps({"type": "conversation_initiation_client_data",
                        "conversation_config_override": {"conversation": {"text_only": True}}}))
    transcript, conv_id, incident, lines = [], "", None, list(CALLER)
    deadline = time.time() + 240
    while time.time() < deadline:
        msg = json.loads(ws.recv())
        kind = msg.get("type")
        if kind == "conversation_initiation_metadata":
            conv_id = msg["conversation_initiation_metadata_event"]["conversation_id"]
        elif kind == "ping":
            ws.send(json.dumps({"type": "pong", "event_id": msg["ping_event"]["event_id"]}))
        elif kind == "agent_response":
            text = msg["agent_response_event"]["agent_response"]
            transcript.append({"role": "agent", "text": text})
            print(f"AGENT:  {text}", flush=True)
            if incident is not None:
                break
            if lines:
                line = lines.pop(0)
                transcript.append({"role": "caller", "text": line})
                print(f"CALLER: {line}", flush=True)
                ws.send(json.dumps({"type": "user_message", "text": line}))
        elif kind == "client_tool_call":
            tc = msg["client_tool_call"]
            params = {**tc["parameters"], "conversation_id": conv_id, "source": "simulated"}
            r = requests.post(f"http://localhost:{port}/api/incidents", json=params, timeout=20)
            incident = r.json()
            result = {k: incident.get(k) for k in ("id", "wo")} | {"hazard": f"{incident['hazard']['id']} {incident['hazard']['title']}"} if r.ok else {"error": incident.get("error")}
            print(f"TOOL create_incident({json.dumps(tc['parameters'])}) -> {json.dumps(result)}", flush=True)
            transcript.append({"role": "tool", "text": f"create_incident → {json.dumps(result)}"})
            ws.send(json.dumps({"type": "client_tool_result", "tool_call_id": tc["tool_call_id"], "result": json.dumps(result), "is_error": not r.ok}))
    ws.close()
    if incident and incident.get("id"):
        requests.post(f"http://localhost:{port}/api/incidents/transcript", timeout=10,
                      json={"id": incident["id"], "conversation_id": conv_id, "transcript": [t for t in transcript if t["role"] != "tool"]})
    return conv_id, transcript, incident


def record_sample(conv_id, transcript, incident):
    """The recorded sample call for the hosted site and offline stage: the real transcript, voiced (caller + agent voices)."""
    os.makedirs(SAMPLE, exist_ok=True)
    audio, turns, t = b"", [], 0.0
    for turn in transcript:
        if turn["role"] == "tool":
            turns.append({**turn, "t": round(t, 2)})
            continue
        mp3 = elevenlabs.tts(turn["text"], elevenlabs.VOICES["agent" if turn["role"] == "agent" else "caller"], fmt="mp3_22050_32")
        turns.append({**turn, "t": round(t, 2)})
        t += len(mp3) * 8 / 32000 + 0.25  # CBR 32 kbps
        audio += mp3
    open(os.path.join(SAMPLE, "sample-call.mp3"), "wb").write(audio)
    inc = {k: v for k, v in (incident or {}).items() if k != "transcript"}
    json.dump({"conversation_id": conv_id, "agent_id": agent_id(), "duration": round(t, 1), "audio": "/hotline/sample-call.mp3",
               "turns": turns, "incident": {**inc, "source": "recorded", "transcript": [x for x in transcript if x["role"] != "tool"]}},
              open(os.path.join(SAMPLE, "sample-call.json"), "w"), indent=1)
    print(f"sample call: {round(t)} s, {len(audio) // 1024} KB")


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("cmd", choices=["setup", "call"])
    a.add_argument("--port", type=int, default=8790)
    a.add_argument("--no-record", action="store_true")
    args = a.parse_args()
    elevenlabs.load_env()
    if not elevenlabs.key():
        sys.exit("ELEVENLABS_API_KEY is not set (.env)")
    if args.cmd == "setup":
        setup()
    else:
        conv, tr, inc = call(args.port)
        if not args.no_record and inc and inc.get("id"):
            record_sample(conv, tr, inc)
