#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="$HOME/.config/usage-waste"
LOG_FILE="$CONFIG_DIR/stats.jsonl"
STATUS_FILE="$CONFIG_DIR/status.json"

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

# ─── Status file (skip reason) ───────────────────────────────────────────────
if [[ -f "$STATUS_FILE" ]]; then
  SKIP_STATUS=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$STATUS_FILE','utf8'));
    if (s.status === 'skipped') {
      console.log('SKIPPED: ' + s.skipReason + ' (at ' + s.lastSkipAt + ')');
    }
  " 2>/dev/null)
  if [[ -n "$SKIP_STATUS" ]]; then
    echo "Warning: $SKIP_STATUS"
    echo ""
  fi
fi

# ─── Aggregate stats from JSONL ──────────────────────────────────────────────
echo "Stats:"
if [[ ! -f "$LOG_FILE" ]]; then
  echo "  No stats log — hook has never completed a call"
  echo ""
  exit 0
fi

node -e "
  const fs = require('fs');
  const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\n').filter(Boolean);

  if (lines.length === 0) {
    console.log('  No entries in log');
    process.exit(0);
  }

  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  let total = 0, success = 0, failed = 0;
  let tokIn = 0, tokOut = 0, tokCacheCreate = 0, tokCacheRead = 0;
  let totalCost = 0;
  const byModel = {};
  const byDate = {};
  const bySession = {};
  const errors = [];

  for (const e of entries) {
    total++;
    if (e.success) success++; else failed++;

    if (e.tokens) {
      tokIn += e.tokens.input || 0;
      tokOut += e.tokens.output || 0;
      tokCacheCreate += e.tokens.cacheCreation || 0;
      tokCacheRead += e.tokens.cacheRead || 0;
    }
    totalCost += e.cost || 0;

    if (e.model) byModel[e.model] = (byModel[e.model] || 0) + 1;

    const dateKey = (e.time || '').slice(0, 10);
    if (dateKey) byDate[dateKey] = (byDate[dateKey] || 0) + 1;

    if (e.session) {
      if (!bySession[e.session]) bySession[e.session] = { calls: 0, tokens: 0, cost: 0 };
      bySession[e.session].calls++;
      bySession[e.session].tokens += (e.tokens?.input || 0) + (e.tokens?.output || 0);
      bySession[e.session].cost += e.cost || 0;
    }

    if (e.error) errors.push(e);
  }

  const rate = total > 0 ? ((success / total) * 100).toFixed(1) + '%' : 'N/A';
  const totalTokens = tokIn + tokOut;
  const last = entries[entries.length - 1];

  console.log('  Total calls: ' + total + ' (success: ' + success + ', failed: ' + failed + ', rate: ' + rate + ')');
  console.log('  Last call:   ' + (last.time || 'unknown'));
  console.log('  Last result: ' + (last.success ? 'success' : 'failed'));

  // Tokens
  console.log('');
  console.log('Tokens:');
  console.log('  Input:          ' + tokIn.toLocaleString());
  console.log('  Output:         ' + tokOut.toLocaleString());
  if (tokCacheCreate > 0) console.log('  Cache creation: ' + tokCacheCreate.toLocaleString());
  if (tokCacheRead > 0)   console.log('  Cache read:     ' + tokCacheRead.toLocaleString());
  console.log('  Total:          ' + totalTokens.toLocaleString());
  console.log('  Cost:           \$' + totalCost.toFixed(4));

  // By model
  console.log('');
  console.log('Breakdown:');
  if (Object.keys(byModel).length > 0) {
    console.log('  By model:');
    for (const [m, c] of Object.entries(byModel)) console.log('    ' + m + ': ' + c);
  }

  // By date (last 7)
  const dates = Object.keys(byDate).sort().slice(-7);
  if (dates.length > 0) {
    console.log('  Recent days:');
    for (const d of dates) console.log('    ' + d + ': ' + byDate[d]);
  }

  // By session (last 5)
  const sessionIds = Object.keys(bySession);
  if (sessionIds.length > 0) {
    console.log('  Sessions (' + sessionIds.length + ' total, last 5):');
    for (const sid of sessionIds.slice(-5)) {
      const s = bySession[sid];
      const sidShort = sid.length > 12 ? sid.slice(0, 6) + '..' + sid.slice(-4) : sid;
      console.log('    ' + sidShort + ': ' + s.calls + ' calls, ' + s.tokens.toLocaleString() + ' tokens, \$' + s.cost.toFixed(4));
    }
  }

  // Errors
  if (errors.length > 0) {
    console.log('');
    console.log('Recent errors (' + errors.length + ' total, last 3):');
    for (const e of errors.slice(-3)) {
      console.log('  [' + e.time + '] ' + (e.error || '').slice(0, 120));
    }
  }
" "$LOG_FILE"

echo ""
