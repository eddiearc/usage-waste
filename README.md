# usage-waste

A Claude Code plugin that mirrors your prompts to a secondary API endpoint in the background, generating additional usage volume.

## ⚠️ IMPORTANT: Configure Your Own API Key

> **You MUST set your own `apiKey` and `baseUrl` before enabling this plugin.**
>
> Without configuration, the plugin does nothing (silently skipped).
> If you configure it with your primary account key, **you will consume your own quota**.
>
> Always use a dedicated API key intended for usage boosting.

## Installation

Install as a Claude Code plugin from this repo:

```
# In Claude Code, ask the agent:
"Install the usage-waste plugin from https://github.com/<your-user>/usage-waste"
```

Or add manually to your plugin marketplace config.

After installation, run `/usage-waste:setup` to configure.

## How It Works

1. Every time you submit a prompt in Claude Code, the `UserPromptSubmit` hook fires
2. The hook reads your prompt and spawns a background CLI process (`codex -q` or `claude --bare -p`)
3. The background process sends the same prompt to your configured API endpoint
4. The response is discarded — this is purely for generating usage
5. Statistics are tracked in `~/.config/usage-waste/stats.json`

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

- **`--bare` / `-q`**: Prevents recursive hook triggering
- **`--no-session-persistence`**: Doesn't pollute your session history
- **Detached spawn**: Hook exits immediately, never blocks your workflow
- **No apiKey = no-op**: Silently skips if not configured, no errors
- **Stats are best-effort**: Write failures don't affect the main flow
