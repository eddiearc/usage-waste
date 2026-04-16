#!/usr/bin/env node

/**
 * Codex session runner — spawned detached by the main hook.
 *
 * Runs `codex exec --json` and captures the session ID from the first
 * JSONL event, then writes it to a session file so subsequent hook
 * invocations can use `codex exec resume <id>`.
 *
 * Usage:
 *   node codex-session-runner.mjs [--session-file <path>] [--provider <p>] [--model <m>] -- <prompt>
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { sessionFile: null, provider: null, model: null, prompt: "" };
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--session-file" && i + 1 < args.length) {
      opts.sessionFile = args[++i];
    } else if (args[i] === "--provider" && i + 1 < args.length) {
      opts.provider = args[++i];
    } else if (args[i] === "--model" && i + 1 < args.length) {
      opts.model = args[++i];
    } else if (args[i] === "--") {
      opts.prompt = args.slice(i + 1).join(" ");
      break;
    }
    i++;
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  if (!opts.prompt) {
    process.exit(0);
  }

  const codexArgs = ["exec", "--json", "--full-auto"];
  if (opts.provider) codexArgs.push("-p", opts.provider);
  if (opts.model) codexArgs.push("-m", opts.model);
  codexArgs.push(opts.prompt);

  const child = spawn("codex", codexArgs, {
    stdio: ["ignore", "pipe", "ignore"],
  });

  let sessionCaptured = false;
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    if (sessionCaptured) return;
    buffer += chunk.toString();

    const lines = buffer.split("\n");
    // Keep incomplete last line in buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        // Codex JSONL events may contain session_id at top level or nested
        const sid = event.session_id || event.id;
        if (sid) {
          sessionCaptured = true;
          saveSessionId(opts.sessionFile, sid);
          // Stop reading stdout — let codex continue running
          child.stdout.destroy();
          return;
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  child.on("close", () => {
    // If we never captured session ID, try the remaining buffer
    if (!sessionCaptured && buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const sid = event.session_id || event.id;
        if (sid && opts.sessionFile) {
          saveSessionId(opts.sessionFile, sid);
        }
      } catch { /* ignore */ }
    }
  });
}

function saveSessionId(sessionFile, codexSessionId) {
  if (!sessionFile) return;
  try {
    const dir = path.dirname(sessionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing file to preserve mainSessionId etc
    let data = {};
    try {
      if (fs.existsSync(sessionFile)) {
        data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      }
    } catch { /* ignore */ }

    data.codexSessionId = codexSessionId;
    data.capturedAt = new Date().toISOString();

    fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // Best effort
  }
}

main();
