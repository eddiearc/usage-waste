#!/usr/bin/env bash
set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
API_KEY=""
BASE_URL=""
MODEL="sonnet"
HOST=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.config/usage-waste/scripts"
LOGS_DIR="$HOME/.config/usage-waste/logs"
STATUS_FILE="$HOME/.config/usage-waste/status.json"

# ─── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)  API_KEY="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --host)     HOST="$2"; shift 2 ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$API_KEY" ]]; then
  echo "ERROR: --api-key is required"
  echo "Usage: bash setup.sh --api-key <key> --base-url <url> [--model <model>] [--host claude,codex]"
  exit 1
fi

if [[ -z "$BASE_URL" ]]; then
  echo "ERROR: --base-url is required"
  echo "Usage: bash setup.sh --api-key <key> --base-url <url> [--model <model>] [--host claude,codex]"
  exit 1
fi

# ─── Step 0: Validate API key and base URL ────────────────────────────────────
echo "==> Validating API key and base URL..."

VALIDATE_OUTPUT=$(echo "hi" | ANTHROPIC_API_KEY="$API_KEY" ANTHROPIC_BASE_URL="$BASE_URL" claude --bare -p \
  --dangerously-skip-permissions \
  --model "${MODEL}" \
  --output-format json \
  2>&1) || true

VALIDATE_OK=false
if echo "$VALIDATE_OUTPUT" | node -e "
  let buf='';
  process.stdin.on('data',c=>buf+=c);
  process.stdin.on('end',()=>{
    try {
      const r=JSON.parse(buf);
      if (r.usage && (r.usage.input_tokens > 0 || r.usage.output_tokens > 0)) {
        console.log('    OK: API responded, input_tokens=' + r.usage.input_tokens + ' output_tokens=' + r.usage.output_tokens);
        process.exit(0);
      }
      if (r.is_error) {
        console.log('    FAIL: ' + (r.result || 'unknown error'));
        process.exit(1);
      }
      console.log('    FAIL: unexpected response');
      process.exit(1);
    } catch {
      console.log('    FAIL: ' + buf.trim().slice(0,200));
      process.exit(1);
    }
  });
" 2>/dev/null; then
  VALIDATE_OK=true
fi

if ! $VALIDATE_OK; then
  echo ""
  echo "ERROR: API validation failed. Check your --api-key and --base-url."
  echo "       Setup aborted. Nothing was installed."
  exit 1
fi

# ─── Step 1: Copy hook scripts ────────────────────────────────────────────────
echo "==> Copying hook scripts to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

HOOK_SRC="$SCRIPT_DIR/usage-waste-hook.mjs"
RUNNER_SRC="$SCRIPT_DIR/usage-waste-runner.mjs"

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "ERROR: Cannot find usage-waste-hook.mjs in $SCRIPT_DIR"
  echo "Run this script from the repo: cd usage-waste && bash scripts/setup.sh ..."
  exit 1
fi

if [[ ! -f "$RUNNER_SRC" ]]; then
  echo "ERROR: Cannot find usage-waste-runner.mjs in $SCRIPT_DIR"
  echo "Run this script from the repo: cd usage-waste && bash scripts/setup.sh ..."
  exit 1
fi

cp "$HOOK_SRC" "$INSTALL_DIR/usage-waste-hook.mjs"
echo "    Copied usage-waste-hook.mjs"
cp "$RUNNER_SRC" "$INSTALL_DIR/usage-waste-runner.mjs"
echo "    Copied usage-waste-runner.mjs"

# ─── Step 2: Detect hosts ────────────────────────────────────────────────────
if [[ -n "$HOST" ]]; then
  IFS=',' read -ra HOSTS <<< "$HOST"
else
  HOSTS=()
  [[ -d "$HOME/.claude" ]] && HOSTS+=(claude)
  [[ -d "$HOME/.codex" ]]  && HOSTS+=(codex)
fi

if [[ ${#HOSTS[@]} -eq 0 ]]; then
  echo "WARNING: No agent detected (~/.claude or ~/.codex not found)"
  echo "         Use --host claude,codex to force installation"
fi

# ─── Step 3: Inject hooks ────────────────────────────────────────────────────
HOOK_CMD="node \"\$HOME/.config/usage-waste/scripts/usage-waste-hook.mjs\""

inject_hook() {
  local config_file="$1"
  local label="$2"

  echo "==> Injecting hook into $label ($config_file)"

  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const hookCmd = process.argv[2];

    let config = {};
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

    // Ensure hooks.UserPromptSubmit exists
    if (!config.hooks) config.hooks = {};
    if (!Array.isArray(config.hooks.UserPromptSubmit)) config.hooks.UserPromptSubmit = [];

    // Check if usage-waste is already registered
    const already = config.hooks.UserPromptSubmit.some(group =>
      Array.isArray(group.hooks) && group.hooks.some(h => h.command && h.command.includes('usage-waste'))
    );

    if (already) {
      console.log('    Already registered, skipping');
      process.exit(0);
    }

    // Append new hook entry
    config.hooks.UserPromptSubmit.push({
      hooks: [{
        type: 'command',
        command: hookCmd,
        timeout: 10
      }]
    });

    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    console.log('    Hook injected');
  " "$config_file" "$HOOK_CMD"
}

for host in "${HOSTS[@]}"; do
  case "$host" in
    claude)
      inject_hook "$HOME/.claude/settings.json" "Claude Code"
      ;;
    codex)
      inject_hook "$HOME/.codex/hooks.json" "Codex"
      ;;
    *)
      echo "WARNING: Unknown host '$host', skipping"
      ;;
  esac
done

# ─── Step 4: Write config file ────────────────────────────────────────────────
CONFIG_FILE="$HOME/.config/usage-waste/config.json"
echo "==> Writing config to $CONFIG_FILE"

node -e "
  const fs = require('fs');
  const file = process.argv[1];
  const apiKey = process.argv[2];
  const baseUrl = process.argv[3];
  const model = process.argv[4];

  const config = { apiKey, baseUrl, model };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log('    Written: apiKey=...' + apiKey.slice(-4) + ', baseUrl=' + baseUrl + ', model=' + model);
" "$CONFIG_FILE" "$API_KEY" "$BASE_URL" "$MODEL"

# ─── Step 5: Verify ──────────────────────────────────────────────────────────
echo "==> Verifying installation..."

# Record state before test
TODAY=$(date +%Y-%m-%d)
TODAY_LOG="$LOGS_DIR/$TODAY.jsonl"
LINES_BEFORE=0
[[ -f "$TODAY_LOG" ]] && LINES_BEFORE=$(wc -l < "$TODAY_LOG")

echo '{"user_prompt":"setup-verify","session_id":"setup-verify"}' | \
  node "$INSTALL_DIR/usage-waste-hook.mjs"

# Wait for background runner to complete
sleep 3

if [[ -f "$TODAY_LOG" ]]; then
  LINES_AFTER=$(wc -l < "$TODAY_LOG")
  if [[ $LINES_AFTER -gt $LINES_BEFORE ]]; then
    LAST_LINE=$(tail -1 "$TODAY_LOG")
    RESULT=$(node -e "const e=JSON.parse(process.argv[1]); console.log(e.success ? 'success' : 'failed: ' + (e.error||'unknown'))" "$LAST_LINE" 2>/dev/null)
    echo "    Result: $RESULT"
    echo "    VERIFIED — log entry written"
  else
    echo "    WARNING: no new log entry — runner may still be running, or check API key/base URL"
  fi
else
  echo "    WARNING: no log file created — check hook script path"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo "  API Key:  ...${API_KEY: -4}"
echo "  Base URL: $BASE_URL"
echo "  Model:    $MODEL"
echo "  Hosts:    ${HOSTS[*]:-none}"
echo "  Config:   $CONFIG_FILE"
echo "  Script:   $INSTALL_DIR/usage-waste-hook.mjs"
echo "  Logs:     $LOGS_DIR/"
echo ""
echo "IMPORTANT: Restart your agent (Claude Code / Codex) for hooks to take effect."
