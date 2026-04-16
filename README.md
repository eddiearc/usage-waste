# usage-waste

每次你提交 prompt 时，后台自动把同样的内容通过 `claude --bare -p` 发到你指定的 API endpoint，刷用量。同一 session 内自动续接对话。

## ⚠️ 必须设置环境变量

> **不设置 `USAGE_WASTE_API_KEY` 插件不会运行。**
>
> 如果你填了自己主账号的 key，**消耗的是你自己的额度**。
> 请使用专门用于刷量的 key。

## 1. 安装

### Claude Code

让 agent 执行：

```
Install the usage-waste plugin from https://github.com/eddiearc/usage-waste
```

或者手动编辑 `~/.claude/settings.json`：

```json
{
  "extraKnownMarketplaces": {
    "usage-waste": {
      "source": { "source": "github", "repo": "eddiearc/usage-waste" }
    }
  },
  "enabledPlugins": {
    "usage-waste@usage-waste": true
  }
}
```

### Codex

手动安装：

```bash
# 下载脚本
mkdir -p ~/.config/usage-waste/scripts
curl -sL https://raw.githubusercontent.com/eddiearc/usage-waste/main/scripts/usage-waste-hook.mjs \
  -o ~/.config/usage-waste/scripts/usage-waste-hook.mjs
```

在 `~/.codex/hooks.json` 中注册（如果文件已存在，合并 `UserPromptSubmit` 部分）：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.config/usage-waste/scripts/usage-waste-hook.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

确保 `~/.codex/config.toml` 中启用了 hook：

```toml
[features]
codex_hooks = true
```

### 两者都需要

设置环境变量（加到 `~/.zshrc` 或 `~/.bashrc`）：

```bash
export USAGE_WASTE_API_KEY="sk-ant-xxx"       # 必填，否则不运行
export USAGE_WASTE_MODEL="sonnet"              # 可选，默认 sonnet
export USAGE_WASTE_BASE_URL="https://..."      # 可选，自定义 endpoint
```

然后**重启 agent** 让 hook 和环境变量生效。

## 2. 验证

```bash
# Claude Code 插件路径
echo '{"user_prompt":"hello","session_id":"test"}' | \
  USAGE_WASTE_API_KEY="sk-ant-xxx" \
  node "$(find ~/.claude/plugins/cache -path '*/usage-waste/*/scripts/usage-waste-hook.mjs' 2>/dev/null | head -1)"

# 或 Codex 手动安装路径
echo '{"user_prompt":"hello","session_id":"test"}' | \
  USAGE_WASTE_API_KEY="sk-ant-xxx" \
  node ~/.config/usage-waste/scripts/usage-waste-hook.mjs
```

检查 stats：

```bash
cat ~/.config/usage-waste/stats.json
```

`totalCalls` 为 1 就说明成功。没有文件说明 `USAGE_WASTE_API_KEY` 没设对。

## 3. 查看用量

```bash
cat ~/.config/usage-waste/stats.json
```

```json
{
  "totalCalls": 42,
  "byModel": { "sonnet": 42 },
  "byDate": { "2026-04-16": 15, "2026-04-15": 27 },
  "lastCall": "2026-04-16T10:30:00Z"
}
```

## 防递归

两层保护防止 hook 无限循环：

1. **`--bare` 模式**：spawned 的 `claude` 进程跳过所有 hooks
2. **`USAGE_WASTE_RUNNING=1`**：子进程带此环境变量，hook 入口处检测到直接退出
