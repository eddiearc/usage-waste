#!/usr/bin/env node

/**
 * Background runner — spawned detached by the hook.
 * Runs `claude --bare -p --output-format json`, captures token usage
 * and success/failure, then writes to stats.
 *
 * Usage (called by hook, not directly):
 *   node usage-waste-runner.mjs <stats-file> <session-id> <model> <args...>
 *   Prompt is read from stdin.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

// ─── Parse args ──────────────────────────────────────────────────────────────
const [,, statsFile, sessionId, model, ...claudeArgs] = process.argv;
const prompt = fs.readFileSync(0, "utf8");

if (!prompt.trim() || !statsFile) {
  process.exit(0);
}

// ─── Run claude with JSON output ─────────────────────────────────────────────
const allArgs = [...claudeArgs, "--output-format", "json"];

const child = execFile("claude", allArgs, {
  timeout: 120_000,
  maxBuffer: 1024 * 1024,
  env: process.env,
}, (error, stdout, stderr) => {
  const success = !error;

  // Parse token usage from JSON output
  let usage = null;
  let costUsd = 0;
  if (stdout) {
    try {
      const result = JSON.parse(stdout);
      usage = result.usage || null;
      costUsd = result.total_cost_usd || 0;
    } catch { /* not valid JSON */ }
  }

  let errorMsg = error
    ? (stderr || error.message || "unknown error").trim().slice(0, 500)
    : null;

  // Mask API keys in error messages
  if (errorMsg) {
    errorMsg = errorMsg.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-****");
    errorMsg = errorMsg.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-****");
  }

  updateStats(statsFile, sessionId, model, success, errorMsg, usage, costUsd);
});

child.stdin.write(prompt);
child.stdin.end();

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateStats(file, sid, mdl, success, errorMsg, usage, costUsd) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
      },
      totalCostUsd: 0,
      byModel: {},
      byDate: {},
      lastCall: null,
      lastResult: null,
      lastError: null,
      recentErrors: [],
      recentSessions: [],
    };

    try {
      if (fs.existsSync(file)) {
        const existing = JSON.parse(fs.readFileSync(file, "utf8"));
        stats = { ...stats, ...existing, tokens: { ...stats.tokens, ...existing.tokens } };
      }
    } catch { /* reset */ }

    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);

    stats.status = "active";
    delete stats.skipReason;
    delete stats.lastSkipAt;

    stats.totalCalls += 1;
    if (success) {
      stats.successCalls += 1;
    } else {
      stats.failedCalls += 1;
    }

    // Accumulate token usage
    if (usage) {
      stats.tokens.input += usage.input_tokens || 0;
      stats.tokens.output += usage.output_tokens || 0;
      stats.tokens.cacheCreation += usage.cache_creation_input_tokens || 0;
      stats.tokens.cacheRead += usage.cache_read_input_tokens || 0;
    }
    stats.totalCostUsd += costUsd || 0;

    stats.byModel[mdl] = (stats.byModel[mdl] || 0) + 1;
    stats.byDate[dateKey] = (stats.byDate[dateKey] || 0) + 1;
    stats.lastCall = now.toISOString();
    stats.lastResult = success ? "success" : "failed";
    stats.lastError = errorMsg || null;

    if (!Array.isArray(stats.recentErrors)) stats.recentErrors = [];
    if (errorMsg) {
      stats.recentErrors.push({ time: now.toISOString(), error: errorMsg });
      if (stats.recentErrors.length > 10) {
        stats.recentErrors = stats.recentErrors.slice(-10);
      }
    }

    if (sid && !stats.recentSessions.includes(sid)) {
      stats.recentSessions.push(sid);
      if (stats.recentSessions.length > 100) {
        stats.recentSessions = stats.recentSessions.slice(-100);
      }
    }

    fs.writeFileSync(file, JSON.stringify(stats, null, 2) + "\n");
  } catch {
    // best effort
  }
}
