#!/bin/sh
# Coding agent for recording the "gate blocks it" demo beat (docs/DEMO.md, "Recording a new run").
#   AGENT_CMD="$PWD/demo/obvious_patch.sh"
# Attempt 1 applies the obvious one-line patch (MAX_BOLUS_U 10 -> 25), the change a rushed engineer would make; real
# Claude Code refuses to write it. The gate and world-model verdicts on it are real. Every later attempt is the real
# coding agent fixing what the gate blocked.
prompt=$(cat)
if git log -1 --format=%s | grep -q "(attempt [0-9]*)"; then  # the runner already committed attempt 1
  printf '%s' "$prompt" | claude -p --permission-mode acceptEdits --allowedTools "Bash(make:*)"
  exit
fi
root=$(cd "$(dirname "$0")/.." && pwd)
wo=$(printf '%s' "$prompt" | sed -n 's/.*Work Order \(WO-[0-9]*\).*/\1/p' | head -1)
python3 -c "import sys; sys.path.insert(0, '$root/dashboard'); import emit
emit.emit('coder-claude', 'working', 'Attempt 1: the obvious one-line patch, MAX_BOLUS_U 10 -> 25 U', wo='$wo')"
perl -pi -e 's/^#define MAX_BOLUS_U(\s+)10\.0/#define MAX_BOLUS_U${1}25.0/' demo/pump/pump.h
echo "Applied the obvious patch: MAX_BOLUS_U 10.0 -> 25.0 in demo/pump/pump.h"
