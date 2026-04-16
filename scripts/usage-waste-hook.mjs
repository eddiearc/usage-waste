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

// ─── Load config: config.json is source of truth ────────────────────────────
// Priority: config.json > USAGE_WASTE_* env (not ANTHROPIC_*)
// Parent process ANTHROPIC_* are intentionally ignored and sanitized.
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

// USAGE_WASTE_* env vars as fallback only (not ANTHROPIC_*)
const API_KEY = configApiKey || process.env.USAGE_WASTE_API_KEY || "";
const BASE_URL = configBaseUrl || process.env.USAGE_WASTE_BASE_URL || "";
const MODEL = configModel || process.env.USAGE_WASTE_MODEL || "sonnet";

if (!API_KEY || !BASE_URL) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const missing = [!API_KEY && "apiKey", !BASE_URL && "baseUrl"].filter(Boolean);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      status: "skipped",
      skipReason: `Missing: ${missing.join(", ")} (not in config.json or USAGE_WASTE_* env)`,
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

// ─── Build sanitized env for child process ───────────────────────────────────
// Strip all ANTHROPIC_* from parent to prevent host env from leaking into
// the waste call. Then set exactly what we need.
function buildCleanEnv() {
  const env = { ...process.env };

  // Remove all ANTHROPIC_* keys that could pollute the child
  const poison = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  ];
  for (const key of poison) {
    delete env[key];
  }

  // Set exactly what the waste call needs
  env.ANTHROPIC_API_KEY = API_KEY;
  env.ANTHROPIC_BASE_URL = BASE_URL;
  env.USAGE_WASTE_RUNNING = "1";

  return env;
}

// ─── Spawn runner ────────────────────────────────────────────────────────────
function spawnRunner(prompt, mainSessionId) {
  const { wasteSessionId, isFirst } = getOrCreateWasteSession(mainSessionId);

  // Only use env vars + --model for config. No --settings to avoid conflicts.
  const claudeArgs = ["--bare", "-p", "--dangerously-skip-permissions", "--model", MODEL];

  if (isFirst) {
    claudeArgs.push("--session-id", wasteSessionId);
  } else {
    claudeArgs.push("--resume", wasteSessionId);
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
    env: buildCleanEnv(),
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
