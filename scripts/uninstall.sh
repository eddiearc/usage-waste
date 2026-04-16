#!/usr/bin/env bash
set -euo pipefail

# ─── Parse args ───────────────────────────────────────────────────────────────
HOST=""
KEEP_STATS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="$2"; shift 2 ;;
    --keep-stats) KEEP_STATS=true; shift ;;
    *)            echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Detect hosts ─────────────────────────────────────────────────────────────
if [[ -n "$HOST" ]]; then
  IFS=',' read -ra HOSTS <<< "$HOST"
else
  HOSTS=()
  [[ -d "$HOME/.claude" ]] && HOSTS+=(claude)
  [[ -d "$HOME/.codex" ]]  && HOSTS+=(codex)
fi

# ─── Remove hook from config ─────────────────────────────────────────────────
remove_hook() {
  local config_file="$1"
  local label="$2"

  if [[ ! -f "$config_file" ]]; then
    echo "    $label config not found, skipping"
    return
  fi

  echo "==> Removing hook from $label ($config_file)"

  node -e "
    const fs = require('fs');
    const file = process.argv[1];

    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { console.log('    Cannot parse config, skipping'); process.exit(0); }

    if (!config.hooks || !Array.isArray(config.hooks.UserPromptSubmit)) {
      console.log('    No UserPromptSubmit hooks found, skipping');
      process.exit(0);
    }

    const before = config.hooks.UserPromptSubmit.length;

    // Remove only hook groups that contain a usage-waste command
    config.hooks.UserPromptSubmit = config.hooks.UserPromptSubmit.filter(group => {
      if (!Array.isArray(group.hooks)) return true;
      return !group.hooks.some(h => h.command && h.command.includes('usage-waste'));
    });

    const after = config.hooks.UserPromptSubmit.length;

    if (before === after) {
      console.log('    No usage-waste hook found, skipping');
      process.exit(0);
    }

    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    console.log('    Removed ' + (before - after) + ' hook entry');
  " "$config_file"
}

for host in "${HOSTS[@]}"; do
  case "$host" in
    claude) remove_hook "$HOME/.claude/settings.json" "Claude Code" ;;
    codex)  remove_hook "$HOME/.codex/hooks.json" "Codex" ;;
    *)      echo "WARNING: Unknown host '$host', skipping" ;;
  esac
done

# ─── Remove env vars from shell profile ───────────────────────────────────────
PROFILE=""
[[ -f "$HOME/.zshrc" ]]  && PROFILE="$HOME/.zshrc"
[[ -z "$PROFILE" && -f "$HOME/.bashrc" ]] && PROFILE="$HOME/.bashrc"

if [[ -n "$PROFILE" ]]; then
  echo "==> Removing env vars from $PROFILE"
  if grep -q "USAGE_WASTE_" "$PROFILE" 2>/dev/null; then
    sed -i '' '/^export USAGE_WASTE_/d' "$PROFILE"
    echo "    Removed USAGE_WASTE_* entries"
  else
    echo "    No USAGE_WASTE_* entries found, skipping"
  fi
else
  echo "==> No shell profile found, skipping env var cleanup"
fi

# ─── Remove scripts ──────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/.config/usage-waste/scripts"
if [[ -d "$INSTALL_DIR" ]]; then
  echo "==> Removing scripts from $INSTALL_DIR"
  rm -f "$INSTALL_DIR/usage-waste-hook.mjs"
  rmdir "$INSTALL_DIR" 2>/dev/null || true
  echo "    Done"
else
  echo "==> No scripts directory found, skipping"
fi

# ─── Remove stats and sessions ───────────────────────────────────────────────
CONFIG_DIR="$HOME/.config/usage-waste"
if [[ -d "$CONFIG_DIR" ]]; then
  if $KEEP_STATS; then
    echo "==> Keeping stats and sessions (--keep-stats)"
  else
    echo "==> Removing $CONFIG_DIR"
    rm -rf "$CONFIG_DIR/sessions"
    rm -f "$CONFIG_DIR/stats.json"
    # Only rmdir if empty — don't rm -rf the whole dir blindly
    rmdir "$CONFIG_DIR" 2>/dev/null && echo "    Removed $CONFIG_DIR" || echo "    Directory not empty, kept $CONFIG_DIR"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Uninstall Complete ==="
echo "  Hosts cleaned: ${HOSTS[*]:-none}"
echo "  Profile:       ${PROFILE:-none}"
echo "  Stats kept:    $KEEP_STATS"
echo ""
echo "Restart your agent (Claude Code / Codex) for changes to take effect."
