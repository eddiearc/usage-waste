# usage-waste

Claude Code 插件 — 每次你提交 prompt 时，后台自动把同样的内容发到你指定的 API endpoint，刷用量。支持 Claude（Anthropic API）和 Codex（OpenAI API）两个后端，同一 session 内自动续接对话。

## ⚠️ 必须配置自己的 API Key

> **不配置 apiKey 插件不会运行。**
>
> 如果你填了自己主账号的 key，**消耗的是你自己的额度**。
> 请使用专门用于刷量的 key。

## 1. 安装

在 Claude Code 里让 agent 执行：

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

安装后**重启 Claude Code** 让 hook 生效。

> **注意**：hook 系统属于 Claude Code，Codex 本身没有 hook。但你可以选择 Codex API 作为后端 — 即 Claude Code 触发 hook，镜像请求发到 OpenAI API。

## 2. 配置

创建 `~/.config/usage-waste/config.json`：

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

`backend` 选 `"codex"` 或 `"claude"`，只需要填对应后端的 apiKey。

也可以用环境变量覆盖（优先级高于配置文件）：

| 变量 | 覆盖 |
|------|------|
| `USAGE_WASTE_ENABLED` | `enabled`（"false" 关闭） |
| `USAGE_WASTE_BACKEND` | `backend` |
| `USAGE_WASTE_CODEX_API_KEY` | `codex.apiKey` |
| `USAGE_WASTE_CODEX_MODEL` | `codex.model` |
| `USAGE_WASTE_CLAUDE_API_KEY` | `claude.apiKey` |
| `USAGE_WASTE_CLAUDE_BASE_URL` | `claude.baseUrl` |
| `USAGE_WASTE_CLAUDE_MODEL` | `claude.model` |

或者直接运行 `/usage-waste:setup`，交互式引导配置。

## 3. 验证是否安装成功

模拟一次 hook 调用：

```bash
echo '{"user_prompt":"hello","session_id":"test"}' | \
  node "$(find ~/.claude/plugins/cache -path '*/usage-waste/*/scripts/usage-waste-hook.mjs' 2>/dev/null | head -1)"
```

然后检查 stats 文件：

```bash
cat ~/.config/usage-waste/stats.json
```

看到 `totalCalls` 为 1 就说明安装成功。如果文件不存在，检查：
- config.json 是否存在且 `enabled: true`
- apiKey 是否已填写（空 key 会静默跳过）
- 插件是否在 `enabledPlugins` 中启用
- Claude Code 是否已重启

## 4. 查看用量统计

```bash
cat ~/.config/usage-waste/stats.json
```

输出示例：

```json
{
  "totalCalls": 42,
  "byBackend": { "codex": 30, "claude": 12 },
  "byModel": { "o3-mini": 30, "sonnet": 12 },
  "byDate": { "2026-04-16": 15, "2026-04-15": 27 },
  "lastCall": "2026-04-16T10:30:00Z",
  "recentSessions": ["sess-abc", "sess-def"]
}
```

或者在 Claude Code 里运行 `/usage-waste:stats` 查看格式化的统计。

## 工作原理

1. `UserPromptSubmit` hook 在每次用户提交 prompt 时触发
2. 读取 prompt，后台 spawn CLI 进程发到配置的 API endpoint
3. 同一 session 内自动续接对话（Claude 用 `--session-id` / `--resume`，Codex 用 `exec resume`）
4. 响应丢弃，统计写入 stats.json
5. `--bare` / `--full-auto` 防止递归触发自身的 hook
6. hook 立即退出，不阻塞你的正常使用
