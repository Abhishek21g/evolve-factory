#!/bin/sh
# Coding agent for recording the Boeing "gate blocks it" beat:
#   AGENT_CMD="$PWD/demo/aircraft/obvious_patch.sh"
# Attempt 1 applies the obvious patch for "add an AoA disagree alert above 5 deg": reuse the existing AoA monitor for
# the alert and set its threshold to the requested 5 deg (AOA_DISAGREE_DEG 5.5 -> 5.0). The gate and world-model
# verdicts on it are real. Every later attempt is real Claude Code fixing what the gate blocked.
prompt=$(cat)
if git log -1 --format=%s | grep -q "(attempt [0-9]*)"; then  # the runner already committed attempt 1
  printf '%s' "$prompt" | claude -p --permission-mode acceptEdits --allowedTools "Bash(make:*)"
  exit
fi
root=$(cd "$(dirname "$0")/../.." && pwd)
wo=$(printf '%s' "$prompt" | sed -n 's/.*Work Order \(WO-[0-9]*\).*/\1/p' | head -1)
python3 -c "import sys; sys.path.insert(0, '$root/dashboard'); import emit
emit.emit('coder-claude', 'working', 'Attempt 1: the obvious patch, reuse the AoA monitor for the alert at 5 deg (AOA_DISAGREE_DEG 5.5 -> 5.0)', wo='$wo')"
perl -pi -e 's/^#define AOA_DISAGREE_DEG(\s+)5\.5/#define AOA_DISAGREE_DEG${1}5.0/' demo/aircraft/fcc.h
printf '\n/* AOA DISAGREE crew alert: shown whenever the AoA monitor rejects the sources. */\nint fcc_aoa_disagree(const fcc_state *s) { return !s->aoa_valid; }\n' >> demo/aircraft/fcc.c
echo "Applied the obvious patch: AOA_DISAGREE_DEG 5.5 -> 5.0 in demo/aircraft/fcc.h, fcc_aoa_disagree() = !aoa_valid"
