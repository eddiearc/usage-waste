#!/usr/bin/env node

/**
 * Background runner — spawned detached by the hook.
 * Runs `claude --bare -p --output-format json`, captures token usage
 * and success/failure, then APPENDS one line to stats.jsonl.
 *
 * Usage (called by hook, not directly):
 *   node usage-waste-runner.mjs <stats-dir> <session-id> <model> <args...>
 *   Prompt is read from stdin.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

// ─── Parse args ──────────────────────────────────────────────────────────────
const [,, statsDir, sessionId, model, ...claudeArgs] = process.argv;
const prompt = fs.readFileSync(0, "utf8");

if (!prompt.trim() || !statsDir) {
  process.exit(0);
}

const LOGS_DIR = path.join(statsDir, "logs");

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

  if (errorMsg) {
    errorMsg = errorMsg.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-****");
    errorMsg = errorMsg.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-****");
  }

  appendLog(success, errorMsg, usage, costUsd);
});

child.stdin.write(prompt);
child.stdin.end();

// ─── Append one line to JSONL ────────────────────────────────────────────────
function appendLog(success, errorMsg, usage, costUsd) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const logFile = path.join(LOGS_DIR, `${dateKey}.jsonl`);

    const entry = {
      time: now.toISOString(),
      session: sessionId || null,
      model,
      success,
      tokens: {
        input: usage?.input_tokens || 0,
        output: usage?.output_tokens || 0,
        cacheCreation: usage?.cache_creation_input_tokens || 0,
        cacheRead: usage?.cache_read_input_tokens || 0,
      },
      cost: costUsd || 0,
    };

    if (errorMsg) entry.error = errorMsg;

    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
  } catch {
    // best effort
  }
}
