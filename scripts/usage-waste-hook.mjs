#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

// ─── Paths ───────────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".config", "usage-waste");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
const DEFAULT_STATS_FILE = path.join(CONFIG_DIR, "stats.json");

// ─── Default config ──────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enabled: true,
  backend: "codex",
  codex: {
    apiKey: "",
    provider: "openai",
    model: "o3-mini",
  },
  claude: {
    apiKey: "",
    baseUrl: "",
    model: "sonnet",
  },
  statsFile: DEFAULT_STATS_FILE,
};

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

// ─── Config ──────────────────────────────────────────────────────────────────
function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      config = {
        ...config,
        ...fileConfig,
        codex: { ...config.codex, ...fileConfig.codex },
        claude: { ...config.claude, ...fileConfig.claude },
      };
    }
  } catch {
    // Config file unreadable, use defaults
  }

  const env = process.env;
  if (env.USAGE_WASTE_ENABLED !== undefined) {
    config.enabled = env.USAGE_WASTE_ENABLED !== "false" && env.USAGE_WASTE_ENABLED !== "0";
  }
  if (env.USAGE_WASTE_BACKEND) config.backend = env.USAGE_WASTE_BACKEND;
  if (env.USAGE_WASTE_CODEX_API_KEY) config.codex.apiKey = env.USAGE_WASTE_CODEX_API_KEY;
  if (env.USAGE_WASTE_CODEX_PROVIDER) config.codex.provider = env.USAGE_WASTE_CODEX_PROVIDER;
  if (env.USAGE_WASTE_CODEX_MODEL) config.codex.model = env.USAGE_WASTE_CODEX_MODEL;
  if (env.USAGE_WASTE_CLAUDE_API_KEY) config.claude.apiKey = env.USAGE_WASTE_CLAUDE_API_KEY;
  if (env.USAGE_WASTE_CLAUDE_BASE_URL) config.claude.baseUrl = env.USAGE_WASTE_CLAUDE_BASE_URL;
  if (env.USAGE_WASTE_CLAUDE_MODEL) config.claude.model = env.USAGE_WASTE_CLAUDE_MODEL;

  if (config.statsFile && config.statsFile.startsWith("~")) {
    config.statsFile = config.statsFile.replace(/^~/, os.homedir());
  }
  if (!config.statsFile) {
    config.statsFile = DEFAULT_STATS_FILE;
  }

  return config;
}

// ─── Session tracking ────────────────────────────────────────────────────────
// Maps main session_id → waste session UUID so all prompts within
// the same main session share a single Claude/Codex conversation.

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionFilePath(mainSessionId, backend) {
  return path.join(SESSIONS_DIR, `${mainSessionId}.${backend}.json`);
}

/**
 * Get or create a waste session for the given main session.
 * Returns { wasteSessionId, isFirst }
 */
function getOrCreateWasteSession(mainSessionId, backend) {
  if (!mainSessionId) {
    // No main session ID — generate a random one, always "first"
    return { wasteSessionId: crypto.randomUUID(), isFirst: true };
  }

  ensureSessionsDir();
  const filePath = sessionFilePath(mainSessionId, backend);

  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { wasteSessionId: data.wasteSessionId, isFirst: false };
    }
  } catch {
    // Corrupted — recreate
  }

  // First prompt in this main session — create a new waste session
  const wasteSessionId = crypto.randomUUID();
  try {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ wasteSessionId, mainSessionId, backend, createdAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8"
    );
  } catch {
    // Write failure — proceed anyway
  }

  return { wasteSessionId, isFirst: true };
}

// ─── Spawn: Codex backend ────────────────────────────────────────────────────
// Codex CLI does not support specifying a session ID upfront.
// We use a runner script that:
//   1st call: `codex exec` → captures session ID from JSONL → saves to file
//   Nth call: `codex exec resume <id>` to continue the same conversation
function spawnCodex(prompt, config, mainSessionId) {
  const { apiKey, provider, model } = config.codex;
  const envOverrides = { ...process.env };
  if (apiKey) envOverrides.OPENAI_API_KEY = apiKey;

  // Check if we already have a codex waste session
  const sessionFile = mainSessionId
    ? sessionFilePath(mainSessionId, "codex")
    : null;

  let existingCodexSessionId = null;
  if (sessionFile) {
    try {
      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
        existingCodexSessionId = data.codexSessionId || null;
      }
    } catch { /* ignore */ }
  }

  if (existingCodexSessionId) {
    // Resume existing codex session
    const args = ["exec", "resume", existingCodexSessionId, "--full-auto"];
    if (model) args.push("-m", model);
    args.push(prompt);

    const child = spawn("codex", args, {
      detached: true,
      stdio: "ignore",
      env: envOverrides,
    });
    child.unref();
  } else {
    // First call — use runner to capture session ID
    const runnerPath = path.join(path.dirname(new URL(import.meta.url).pathname), "codex-session-runner.mjs");
    const args = [runnerPath];
    if (sessionFile) args.push("--session-file", sessionFile);
    if (provider) args.push("--provider", provider);
    if (model) args.push("--model", model);
    args.push("--", prompt);

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: envOverrides,
    });
    child.unref();
  }
}

// ─── Spawn: Claude backend ───────────────────────────────────────────────────
// Claude CLI supports `--session-id <uuid>` (first call) and
// `--resume <uuid>` (subsequent calls) — perfect session continuation.
function spawnClaude(prompt, config, mainSessionId) {
  const { apiKey, baseUrl, model } = config.claude;
  const { wasteSessionId, isFirst } = getOrCreateWasteSession(mainSessionId, "claude");

  const args = ["--bare", "-p"];
  if (model) args.push("--model", model);

  if (isFirst) {
    // First prompt — create session with known UUID
    args.push("--session-id", wasteSessionId);
  } else {
    // Subsequent prompts — resume the same session
    args.push("--resume", wasteSessionId);
  }

  if (baseUrl) {
    const settings = JSON.stringify({
      provider: { baseUrl, ...(apiKey ? { apiKey } : {}) },
    });
    args.push("--settings", settings);
  }

  const envOverrides = {};
  if (apiKey) envOverrides.ANTHROPIC_API_KEY = apiKey;

  const child = spawn("claude", args, {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: { ...process.env, ...envOverrides },
  });

  child.stdin.write(prompt);
  child.stdin.end();
  child.unref();
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateStats(config, sessionId) {
  try {
    const statsFile = config.statsFile;
    const statsDir = path.dirname(statsFile);
    if (!fs.existsSync(statsDir)) {
      fs.mkdirSync(statsDir, { recursive: true });
    }

    let stats = {
      totalCalls: 0,
      byBackend: {},
      byModel: {},
      byDate: {},
      lastCall: null,
      recentSessions: [],
    };

    if (fs.existsSync(statsFile)) {
      try {
        stats = { ...stats, ...JSON.parse(fs.readFileSync(statsFile, "utf8")) };
      } catch {
        // Corrupted stats, reset
      }
    }

    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const backend = config.backend;
    const model = backend === "codex" ? config.codex.model : config.claude.model;

    stats.totalCalls += 1;
    stats.byBackend[backend] = (stats.byBackend[backend] || 0) + 1;
    stats.byModel[model] = (stats.byModel[model] || 0) + 1;
    stats.byDate[dateKey] = (stats.byDate[dateKey] || 0) + 1;
    stats.lastCall = now.toISOString();

    if (sessionId && !stats.recentSessions.includes(sessionId)) {
      stats.recentSessions.push(sessionId);
      if (stats.recentSessions.length > 100) {
        stats.recentSessions = stats.recentSessions.slice(-100);
      }
    }

    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2) + "\n", "utf8");
  } catch {
    // Stats update failure must not block the main flow
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const input = readHookInput();
  const userPrompt = input.user_prompt;
  if (!userPrompt || !userPrompt.trim()) {
    return;
  }

  const config = loadConfig();
  if (!config.enabled) {
    return;
  }

  const backend = config.backend;
  const backendConfig = backend === "codex" ? config.codex : config.claude;

  if (!backendConfig.apiKey) {
    return;
  }

  const mainSessionId = input.session_id || null;

  if (backend === "codex") {
    spawnCodex(userPrompt.trim(), config, mainSessionId);
  } else {
    spawnClaude(userPrompt.trim(), config, mainSessionId);
  }

  updateStats(config, mainSessionId);
}

main();
