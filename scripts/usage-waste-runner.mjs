#!/usr/bin/env node

/**
 * Background runner — spawned detached by the hook.
 * Runs `claude --bare -p --output-format json`, captures token usage
 * and success/failure, then APPENDS one line to logs/<date>.jsonl.
 *
 * Usage (called by hook, not directly):
 *   node usage-waste-runner.mjs <stats-dir> <session-id> <model> <args...>
 *   Prompt is read from stdin.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

// ─── Parse args ──────────────────────────────────────────────────────────────
const [,, statsDir, sessionId, model, promptFile, ...claudeArgs] = process.argv;

if (!promptFile || !statsDir) {
  process.exit(0);
}

let prompt = "";
try {
  prompt = fs.readFileSync(promptFile, "utf8");
  // Clean up temp file immediately after reading
  fs.unlinkSync(promptFile);
} catch {
  process.exit(0);
}

if (!prompt.trim()) {
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

  // Parse JSON result from stdout
  let usage = null;
  let costUsd = 0;
  let apiError = null;

  if (stdout) {
    try {
      const result = JSON.parse(stdout);
      usage = result.usage || null;
      costUsd = result.total_cost_usd || 0;

      // Extract structured error info from claude JSON response
      if (result.is_error || result.api_error_status) {
        apiError = {
          status: result.api_error_status || null,
          message: (result.result || "").slice(0, 300),
        };
      }
    } catch { /* not valid JSON */ }
  }

  // Build error message: prefer structured info, fall back to stderr
  let errorMsg = null;
  if (!success) {
    if (apiError) {
      // Structured error from claude JSON output
      errorMsg = apiError.status
        ? `[${apiError.status}] ${apiError.message}`
        : apiError.message;
    } else if (stderr && stderr.trim()) {
      errorMsg = stderr.trim().slice(0, 500);
    } else if (error) {
      errorMsg = (error.message || "unknown error").slice(0, 500);
    } else {
      errorMsg = "unknown error";
    }
  } else if (apiError) {
    // claude exited 0 but response indicates error (e.g., is_error: true)
    errorMsg = apiError.status
      ? `[${apiError.status}] ${apiError.message}`
      : apiError.message;
  }

  // Mask API keys in error messages
  if (errorMsg) {
    errorMsg = errorMsg.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-****");
    errorMsg = errorMsg.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-****");
  }

  appendLog(!errorMsg, errorMsg, usage, costUsd);
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
