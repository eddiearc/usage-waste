#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="$HOME/.config/usage-waste"
STATS_FILE="$CONFIG_DIR/stats.json"

echo "=== usage-waste Status ==="
echo ""

# ─── Environment variables ────────────────────────────────────────────────────
echo "Environment:"

if [[ -n "${USAGE_WASTE_API_KEY:-}" ]]; then
  KEY="$USAGE_WASTE_API_KEY"
  LEN=${#KEY}
  if [[ $LEN -le 8 ]]; then
    MASKED="****"
  else
    MASKED="${KEY:0:4}$( printf '*%.0s' $(seq 1 $((LEN - 8))) )${KEY: -4}"
  fi
  echo "  API Key:  $MASKED"
else
  echo "  API Key:  NOT SET"
fi

if [[ -n "${USAGE_WASTE_BASE_URL:-}" ]]; then
  echo "  Base URL: $USAGE_WASTE_BASE_URL"
else
  echo "  Base URL: NOT SET"
fi

echo "  Model:    ${USAGE_WASTE_MODEL:-sonnet (default)}"
echo ""

# ─── Hook registration ───────────────────────────────────────────────────────
echo "Hooks:"

check_hook() {
  local file="$1" label="$2"
  if [[ ! -f "$file" ]]; then
    echo "  $label: config not found"
    return
  fi
  if grep -q "usage-waste" "$file" 2>/dev/null; then
    echo "  $label: registered"
  else
    echo "  $label: NOT registered"
  fi
}

check_hook "$HOME/.claude/settings.json" "Claude Code"
check_hook "$HOME/.codex/hooks.json" "Codex"
echo ""

# ─── Script installed ────────────────────────────────────────────────────────
echo "Script:"
SCRIPT="$CONFIG_DIR/scripts/usage-waste-hook.mjs"
if [[ -f "$SCRIPT" ]]; then
  echo "  $SCRIPT  OK"
else
  echo "  $SCRIPT  NOT FOUND"
fi
echo ""

# ─── Stats ────────────────────────────────────────────────────────────────────
echo "Stats:"
if [[ ! -f "$STATS_FILE" ]]; then
  echo "  No stats file — hook has never fired"
  echo ""
  exit 0
fi

node -e "
  const fs = require('fs');
  const stats = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));

  console.log('  Status:      ' + (stats.status || 'unknown'));

  if (stats.skipReason) {
    console.log('  Skip reason: ' + stats.skipReason);
    console.log('  Last skip:   ' + (stats.lastSkipAt || 'unknown'));
    process.exit(0);
  }

  const total = stats.totalCalls || 0;
  const success = stats.successCalls || 0;
  const failed = stats.failedCalls || 0;
  const rate = total > 0 ? ((success / total) * 100).toFixed(1) + '%' : 'N/A';

  console.log('  Total calls: ' + total + ' (success: ' + success + ', failed: ' + failed + ', rate: ' + rate + ')');
  console.log('  Last call:   ' + (stats.lastCall || 'never'));
  console.log('  Last result: ' + (stats.lastResult || 'unknown'));

  if (stats.lastError) {
    console.log('  Last error:  ' + stats.lastError);
  }

  if (stats.byModel && Object.keys(stats.byModel).length > 0) {
    console.log('  By model:');
    for (const [model, count] of Object.entries(stats.byModel)) {
      console.log('    ' + model + ': ' + count);
    }
  }

  if (stats.byDate && Object.keys(stats.byDate).length > 0) {
    const dates = Object.keys(stats.byDate).sort().slice(-7);
    console.log('  Recent days:');
    for (const d of dates) {
      console.log('    ' + d + ': ' + stats.byDate[d]);
    }
  }

  console.log('  Sessions:    ' + (stats.recentSessions ? stats.recentSessions.length : 0));

  const errors = stats.recentErrors || [];
  if (errors.length > 0) {
    console.log('');
    console.log('  Recent errors (' + errors.length + '):');
    for (const e of errors.slice(-5)) {
      console.log('    [' + e.time + '] ' + e.error.slice(0, 120));
    }
  }
" "$STATS_FILE"

echo ""
