"""ElevenLabs REST calls the factory makes: text to speech, sound effects, the hotline agent, conversation tokens.

The key is read from ELEVENLABS_API_KEY (.env) and never sent to the browser. Every call has a timeout; nothing in the
demo path waits on these: callout clips are generated once and committed, the hotline token is fetched on click.
"""
import os
import re

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.elevenlabs.io"
TTS_MODEL = "eleven_multilingual_v2"
VOICES = {  # premade voices
    "cockpit": "nPczCjzI2devNBz1zQrb",  # Brian: calm American male, the synthetic cockpit voice
    "pump": "EXAVITQu4vr4xnSDxMaL",     # Sarah: the pump's alarm voice
    "agent": "Xb7hH8MSUJpSbSDYk0k2",    # Alice: the safety hotline agent
    "caller": "iP95p4xoKVk53GoZ742B",   # Chris: the caller in the recorded sample call
}


def load_env():
    """KEY=value lines from .env (this checkout's, else the main checkout's), without overriding the environment."""
    for p in (os.path.join(ROOT, ".env"), os.path.expanduser("~/evolve-factory/.env")):
        if os.path.exists(p):
            for line in open(p):
                m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
                if m and not line.lstrip().startswith("#"):
                    os.environ.setdefault(m.group(1), m.group(2).strip("\"'"))
            return


def key():
    """The API key; re-reads .env while it is missing, so a running server picks up a key added later."""
    if not os.environ.get("ELEVENLABS_API_KEY"):
        os.environ.pop("ELEVENLABS_API_KEY", None)
        load_env()
    return os.environ.get("ELEVENLABS_API_KEY")


def _req(method, path, timeout=30, **kw):
    r = requests.request(method, API + path, headers={"xi-api-key": key() or ""}, timeout=timeout, **kw)
    if not r.ok:
        raise RuntimeError(f"ElevenLabs {method} {path.split('?')[0]}: {r.status_code} {r.text[:300]}")
    return r


def tts(text, voice, fmt="mp3_44100_64"):
    return _req("POST", f"/v1/text-to-speech/{voice}?output_format={fmt}",
                json={"text": text, "model_id": TTS_MODEL, "voice_settings": {"stability": 0.85, "similarity_boost": 0.7}}).content


def sfx(prompt, seconds, fmt="mp3_44100_64"):
    return _req("POST", f"/v1/sound-generation?output_format={fmt}",
                json={"text": prompt, "duration_seconds": seconds, "prompt_influence": 0.6}).content


def create_tool(config):
    return _req("POST", "/v1/convai/tools", json={"tool_config": config}).json()["id"]


def update_tool(tool_id, config):
    return _req("PATCH", f"/v1/convai/tools/{tool_id}", json={"tool_config": config}).json()


def create_agent(body):
    return _req("POST", "/v1/convai/agents/create", json=body).json()["agent_id"]


def update_agent(agent_id, body):
    return _req("PATCH", f"/v1/convai/agents/{agent_id}", json=body).json()


def conversation_token(agent_id):
    """WebRTC token for a browser session with the private agent (the browser never sees the key)."""
    return _req("GET", f"/v1/convai/conversation/token?agent_id={agent_id}", timeout=8).json()["token"]


def signed_url(agent_id):
    """WebSocket URL for a session with the private agent (used by the text-mode test caller)."""
    return _req("GET", f"/v1/convai/conversation/get-signed-url?agent_id={agent_id}", timeout=8).json()["signed_url"]


def conversation(conversation_id):
    return _req("GET", f"/v1/convai/conversations/{conversation_id}", timeout=8).json()
