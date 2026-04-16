# usage-waste

A Claude Code plugin that mirrors your prompts to a secondary API endpoint in the background, generating additional usage volume.

Supports both **Claude** (Anthropic API) and **Codex** (OpenAI API) backends, with **session continuation** — all mirrored prompts within the same session share a single conversation context.

## ⚠️ IMPORTANT: Configure Your Own API Key

> **You MUST set your own `apiKey` and `baseUrl` before enabling this plugin.**
>
> Without configuration, the plugin does nothing (silently skipped).
> If you configure it with your primary account key, **you will consume your own quota**.
>
> Always use a dedicated API key intended for usage boosting.

## Installation

```
# In Claude Code, ask the agent:
"Install the usage-waste plugin from https://github.com/eddiearc/usage-waste"
```

After installation, run `/usage-waste:setup` to configure.

## How It Works

1. Every time you submit a prompt in Claude Code, the `UserPromptSubmit` hook fires
2. The hook reads your prompt and sends it to your configured API endpoint in the background
3. The response is discarded — this is purely for generating usage
4. **Session continuation**: all prompts within the same Claude Code session are sent to the same backend session, building up conversation context
5. Statistics are tracked in `~/.config/usage-waste/stats.json`

### Session Continuation

| Backend | How |
|---------|-----|
| **Claude** | 1st prompt: `claude --bare -p --session-id <uuid>` creates a session with a known UUID. Subsequent prompts: `--resume <uuid>` continues the same session. |
| **Codex** | 1st prompt: `codex exec --json` via a runner script that captures the auto-generated session ID. Subsequent prompts: `codex exec resume <id>` continues the same session. |

Session mappings are stored in `~/.config/usage-waste/sessions/`.

## Configuration

Config file: `~/.config/usage-waste/config.json`

```json
{
  "enabled": true,
  "backend": "codex",
  "codex": {
    "apiKey": "sk-xxx",
    "provider": "openai",
    "model": "o3-mini"
  },
  "claude": {
    "apiKey": "sk-ant-xxx",
    "baseUrl": "https://your-endpoint.com",
    "model": "sonnet"
  },
  "statsFile": "~/.config/usage-waste/stats.json"
}
```

### Environment Variable Overrides

Environment variables take highest priority:

| Variable | Overrides |
|----------|-----------|
| `USAGE_WASTE_ENABLED` | `enabled` (set "false" to disable) |
| `USAGE_WASTE_BACKEND` | `backend` ("codex" or "claude") |
| `USAGE_WASTE_CODEX_API_KEY` | `codex.apiKey` |
| `USAGE_WASTE_CODEX_PROVIDER` | `codex.provider` |
| `USAGE_WASTE_CODEX_MODEL` | `codex.model` |
| `USAGE_WASTE_CLAUDE_API_KEY` | `claude.apiKey` |
| `USAGE_WASTE_CLAUDE_BASE_URL` | `claude.baseUrl` |
| `USAGE_WASTE_CLAUDE_MODEL` | `claude.model` |

## Skills

- `/usage-waste:setup` — Interactive setup wizard with verification
- `/usage-waste:stats` — View usage statistics

## Design Choices

- **`--bare` / `--full-auto`**: Prevents recursive hook triggering on the mirrored calls
- **Session continuation**: Same main session → same waste session, conversation context accumulates
- **Detached spawn**: Hook exits immediately, never blocks your workflow
- **No apiKey = no-op**: Silently skips if not configured, no errors
- **Stats are best-effort**: Write failures don't affect the main flow
- **Prompt via stdin**: Avoids command-line length limits and shell escaping issues
