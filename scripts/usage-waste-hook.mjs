#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

// ─── Recursion guard ─────────────────────────────────────────────────────────
// The spawned `claude --bare` skips hooks, but as a belt-and-suspenders
// measure we also set USAGE_WASTE_RUNNING=1 on the child process.
if (process.env.USAGE_WASTE_RUNNING === "1") {
  process.exit(0);
}

// ─── Required env vars ───────────────────────────────────────────────────────
const API_KEY = process.env.USAGE_WASTE_API_KEY;
const BASE_URL = process.env.USAGE_WASTE_BASE_URL;
if (!API_KEY || !BASE_URL) {
  // Both required — silently skip if not configured
  process.exit(0);
}

const MODEL = process.env.USAGE_WASTE_MODEL || "sonnet";

// ─── Paths ───────────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".config", "usage-waste");
const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const STATS_FILE = path.join(CONFIG_DIR, "stats.json");

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

// ─── Spawn claude ────────────────────────────────────────────────────────────
function spawnClaude(prompt, mainSessionId) {
  const { wasteSessionId, isFirst } = getOrCreateWasteSession(mainSessionId);

  const args = ["--bare", "-p"];
  args.push("--model", MODEL);

  if (isFirst) {
    args.push("--session-id", wasteSessionId);
  } else {
    args.push("--resume", wasteSessionId);
  }

  if (BASE_URL) {
    args.push("--settings", JSON.stringify({
      provider: { baseUrl: BASE_URL, apiKey: API_KEY },
    }));
  }

  const child = spawn("claude", args, {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: API_KEY,
      USAGE_WASTE_RUNNING: "1",  // recursion guard
    },
  });

  child.stdin.write(prompt);
  child.stdin.end();
  child.unref();
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateStats(sessionId) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let stats = { totalCalls: 0, byModel: {}, byDate: {}, lastCall: null, recentSessions: [] };
    try {
      if (fs.existsSync(STATS_FILE)) {
        stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, "utf8")) };
      }
    } catch { /* reset */ }

    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);

    stats.totalCalls += 1;
    stats.byModel[MODEL] = (stats.byModel[MODEL] || 0) + 1;
    stats.byDate[dateKey] = (stats.byDate[dateKey] || 0) + 1;
    stats.lastCall = now.toISOString();

    if (sessionId && !stats.recentSessions.includes(sessionId)) {
      stats.recentSessions.push(sessionId);
      if (stats.recentSessions.length > 100) {
        stats.recentSessions = stats.recentSessions.slice(-100);
      }
    }

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + "\n");
  } catch { /* best effort */ }
}

// ─── Main ────────────────────────────────────────────────────────────────────
const input = readHookInput();
const prompt = input.user_prompt?.trim();
if (!prompt) process.exit(0);

spawnClaude(prompt, input.session_id || null);
updateStats(input.session_id || null);
