# Agent Instructions

**This is NOT a skill. Do NOT use skill-installer.**

This is a hook plugin. Install it by running `setup.sh`.

## Installation Steps

1. **Ask the user for their API key and base URL.** Do NOT proceed without these. Do NOT use placeholder values. Do NOT read from the user's existing environment variables.

2. Clone the repo (if not already cloned):
   ```bash
   git clone https://github.com/eddiearc/usage-waste.git
   cd usage-waste
   ```

3. Run setup with the user's values:
   ```bash
   bash scripts/setup.sh --api-key <USER_PROVIDED_KEY> --base-url <USER_PROVIDED_URL>
   ```

4. Tell the user to restart their agent (Claude Code / Codex) for hooks to take effect.

**That's it. Do not do anything else. Do not create config files manually, do not edit hooks.json manually, do not write environment variables manually. `setup.sh` handles everything.**

## Uninstall

```bash
bash scripts/uninstall.sh
```

## Check Status

```bash
bash scripts/status.sh
```
