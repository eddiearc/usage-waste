---
name: setup
description: Install and configure usage-waste plugin on Claude Code or Codex — handles plugin registration, API key setup, and verification.
---

# usage-waste Setup

You are helping the user install and configure the **usage-waste** plugin. This plugin mirrors every user prompt to a secondary API endpoint in the background, purely to generate usage volume.

## Step 1: Detect environment and install plugin

First, determine which environment the user is running in, then guide installation accordingly.

### Claude Code

Check if the plugin is already installed:

```bash
ls -d ~/.claude/plugins/cache/*/usage-waste 2>/dev/null
```

If not installed, tell the user to run:

```bash
claude plugin add https://github.com/eddiearc/usage-waste
```

Or guide them to add the marketplace source manually in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "usage-waste": {
      "source": {
        "source": "github",
        "repo": "eddiearc/usage-waste"
      }
    }
  },
  "enabledPlugins": {
    "usage-waste@usage-waste": true
  }
}
```

After adding, the user needs to **restart Claude Code** for hooks to load.

### Codex

Codex does not have a native plugin system with hooks. To use usage-waste with Codex as the **host** (i.e., the hook fires from within Codex), the user must install it through Claude Code (since the hook system belongs to Claude Code).

However, Codex can still be the **backend** — meaning Claude Code fires the hook, and the mirrored prompt is sent to the OpenAI/Codex API. This is the default configuration.

Explain this distinction to the user:
- **Host** = where the hook runs (always Claude Code)
- **Backend** = where the mirrored prompt is sent (codex API or claude API)

## Step 2: Check existing config

Read `~/.config/usage-waste/config.json`. If it exists, show the current configuration (mask apiKey to show only last 4 chars). If not, proceed to create it.

## Step 2: Warn about API key

⚠️ **CRITICAL WARNING** ⚠️

Display this warning prominently to the user:

> **You MUST configure your own apiKey and baseUrl.**
> Without these, the plugin will use YOUR personal/primary account quota.
> This can result in unexpected charges on your own billing account.
> 
> Make sure you have a dedicated API key for usage boosting before proceeding.

Use AskUserQuestion to confirm the user understands this before continuing.

## Step 3: Collect configuration

Use AskUserQuestion to ask:

1. **Backend**: codex or claude?
2. **API Key**: The API key for the chosen backend
3. **Model**: Which model to use (default: o3-mini for codex, sonnet for claude)
4. For codex: **Provider** (default: openai)
5. For claude: **Base URL** (if using a custom endpoint)

## Step 4: Write config

Create the directory `~/.config/usage-waste/` if it doesn't exist, then write `config.json`:

```json
{
  "enabled": true,
  "backend": "<chosen>",
  "codex": {
    "apiKey": "<key or empty>",
    "provider": "<provider>",
    "model": "<model>"
  },
  "claude": {
    "apiKey": "<key or empty>",
    "baseUrl": "<url or empty>",
    "model": "<model>"
  },
  "statsFile": "~/.config/usage-waste/stats.json"
}
```

## Step 5: Verify installation

Run a verification test by simulating a hook call:

```bash
echo '{"user_prompt":"usage-waste verification ping","session_id":"setup-verify"}' | \
  node "$(ls -d ~/.claude/plugins/cache/*/usage-waste/*/scripts/usage-waste-hook.mjs 2>/dev/null | head -1 || echo ~/.claude/plugins/cache/usage-waste/scripts/usage-waste-hook.mjs)" 
```

Then wait 3 seconds and check the stats file:

```bash
cat ~/.config/usage-waste/stats.json
```

If `totalCalls` > 0, the installation is successful. Report the result to the user.

If the hook script path is not found, guide the user to ensure the plugin is properly installed and enabled in Claude Code.

## Step 6: Show summary

Display:
- Backend: codex/claude
- Model: <model>
- API Key: configured (show last 4 chars)
- Stats file: ~/.config/usage-waste/stats.json
- Status: enabled and verified / needs attention
