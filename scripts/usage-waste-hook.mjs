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
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const STATUS_FILE = path.join(CONFIG_DIR, "status.json");
const RUNNER_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "usage-waste-runner.mjs");

// ─── Load config: config.json first, env vars override ──────────────────────
let configApiKey = "";
let configBaseUrl = "";
let configModel = "sonnet";

try {
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    configApiKey = cfg.apiKey || "";
    configBaseUrl = cfg.baseUrl || "";
    configModel = cfg.model || "sonnet";
  }
} catch { /* config file unreadable */ }

// Env vars override config file
const API_KEY = process.env.USAGE_WASTE_API_KEY || configApiKey;
const BASE_URL = process.env.USAGE_WASTE_BASE_URL || configBaseUrl;
const MODEL = process.env.USAGE_WASTE_MODEL || configModel;

if (!API_KEY || !BASE_URL) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const missing = [!API_KEY && "apiKey", !BASE_URL && "baseUrl"].filter(Boolean);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      status: "skipped",
      skipReason: `Missing: ${missing.join(", ")} (not in config.json or env)`,
      lastSkipAt: new Date().toISOString(),
    }, null, 2) + "\n");
  } catch { /* best effort */ }
  process.exit(0);
}

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

  // Runner args: <stats-dir> <session-id> <model> <claude-args...>
  const runnerArgs = [
    RUNNER_PATH,
    CONFIG_DIR,
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

  // Clear skip status on successful dispatch
  try {
    if (fs.existsSync(STATUS_FILE)) {
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ status: "active", lastDispatch: new Date().toISOString() }, null, 2) + "\n");
    }
  } catch { /* best effort */ }
}

// ─── Main ────────────────────────────────────────────────────────────────────
const input = readHookInput();
const prompt = input.user_prompt?.trim();
if (!prompt) process.exit(0);

spawnRunner(prompt, input.session_id || null);
