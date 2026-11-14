# Safety hotline (ElevenLabs Agents)

A phone call becomes a traced work order. The hotline is an ElevenLabs Agents (Conversational AI) agent with one
client tool, `create_incident`. When the caller confirms the read-back summary, the agent calls the tool and the
factory (`POST /api/incidents`, `factory/incidents.py`) creates:

1. a draft work order on the project the caller named (else by keyword: aircraft vs pump vocabulary),
2. a memory item in HydraDB `org_memory` (`memory.remember`, local copy always),
3. a trace link on the most likely hazard in the project's `safety.json` (stemmed keyword overlap, title counts
   double; deterministic), pointing at the incident. It shows on the hazard in Traceability.

The agent reads back the incident id, work order and hazard it got from the tool.

## Setup (once)

```bash
# ELEVENLABS_API_KEY in .env
.venv/bin/python factory/hotline.py setup     # creates/updates the tool and agent; ids in demo/hotline/agent.json
```

The agent is private (`enable_auth`): the browser asks the factory server for a WebRTC conversation token
(`GET /api/hotline/token`), so the key never leaves the laptop.

## In the app

Project → **Incidents** → **Call safety hotline** (microphone). The browser runs the call with `@elevenlabs/client`
and executes `create_incident` itself, forwarding it to the local factory. A client tool needs no public URL.
Without a factory server (hosted site) or without a key, the page plays the recorded sample call
(`web/public/hotline/sample-call.*`): a real conversation with the agent, voiced for replay.

## Test caller (text mode)

```bash
.venv/bin/python factory/server.py 8853 &
.venv/bin/python factory/hotline.py call --port 8853   # real conversation over the agent's WebSocket, scripted caller
```

It also rewrites the recorded sample call. Add `--no-record` to leave it alone.

## A real phone number (Twilio), not wired

Not configured: there are no Twilio credentials in `.env`. To add one:

1. Buy a Twilio number; in the ElevenLabs dashboard, Agents → Phone Numbers → Import from Twilio (account SID, auth
   token, number) and assign it to "Certus Safety Hotline".
2. A phone call has no browser, so `create_incident` must become a **webhook** tool instead of a client tool:
   `POST https://<public-url>/api/incidents` with the same parameters. Expose the factory with a tunnel
   (e.g. `cloudflared tunnel --url http://localhost:8787`) and update the tool's `api_schema.url`.
