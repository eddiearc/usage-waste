#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

// ─── Recursion guard ─────────────────────────────────────────────────────────
if (process.env.USAGE_WASTE_RUNNING === "1") {
  process.exit(0);
}

// ─── Paths ───────────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".config", "usage-waste");
const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const STATS_FILE = path.join(CONFIG_DIR, "stats.json");
const RUNNER_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "usage-waste-runner.mjs");

// ─── Required env vars ───────────────────────────────────────────────────────
const API_KEY = process.env.USAGE_WASTE_API_KEY;
const BASE_URL = process.env.USAGE_WASTE_BASE_URL;
if (!API_KEY || !BASE_URL) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    let stats = { totalCalls: 0, successCalls: 0, failedCalls: 0, byModel: {}, byDate: {}, lastCall: null, lastResult: null, lastError: null, recentErrors: [], recentSessions: [] };
    try {
      if (fs.existsSync(STATS_FILE)) stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, "utf8")) };
    } catch { /* reset */ }

    const missing = [!API_KEY && "USAGE_WASTE_API_KEY", !BASE_URL && "USAGE_WASTE_BASE_URL"].filter(Boolean);
    stats.status = "skipped";
    stats.skipReason = `Missing env: ${missing.join(", ")}`;
    stats.lastSkipAt = new Date().toISOString();
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + "\n");
  } catch { /* best effort */ }
  process.exit(0);
}

const MODEL = process.env.USAGE_WASTE_MODEL || "sonnet";

// ─── stdin ───────────────────────────────────────────────────────────────────
function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ─── Session tracking ────────────────────────────────────────────────────────
function getOrCreateWasteSession(mainSessionId) {
  if (!mainSessionId) {
    return { wasteSessionId: crypto.randomUUID(), isFirst: true };
  }

  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const filePath = path.join(SESSIONS_DIR, `${mainSessionId}.json`);

  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { wasteSessionId: data.wasteSessionId, isFirst: false };
    }
  } catch { /* corrupted — recreate */ }

  const wasteSessionId = crypto.randomUUID();
  try {
    fs.writeFileSync(filePath, JSON.stringify({ wasteSessionId, mainSessionId, createdAt: new Date().toISOString() }, null, 2) + "\n");
  } catch { /* best effort */ }

  return { wasteSessionId, isFirst: true };
}

// ─── Spawn runner ────────────────────────────────────────────────────────────
function spawnRunner(prompt, mainSessionId) {
  const { wasteSessionId, isFirst } = getOrCreateWasteSession(mainSessionId);

  // Build claude args
  const claudeArgs = ["--bare", "-p", "--model", MODEL];

  if (isFirst) {
    claudeArgs.push("--session-id", wasteSessionId);
  } else {
    claudeArgs.push("--resume", wasteSessionId);
  }

  if (BASE_URL) {
    claudeArgs.push("--settings", JSON.stringify({
      provider: { baseUrl: BASE_URL, apiKey: API_KEY },
    }));
  }

  // Runner args: <stats-file> <session-id> <model> <claude-args...>
  const runnerArgs = [
    RUNNER_PATH,
    STATS_FILE,
    mainSessionId || "",
    MODEL,
    ...claudeArgs,
  ];

  const child = spawn(process.execPath, runnerArgs, {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: API_KEY,
      USAGE_WASTE_RUNNING: "1",
    },
  });

  child.stdin.write(prompt);
  child.stdin.end();
  child.unref();
}

// ─── Main ────────────────────────────────────────────────────────────────────
const input = readHookInput();
const prompt = input.user_prompt?.trim();
if (!prompt) process.exit(0);

spawnRunner(prompt, input.session_id || null);
