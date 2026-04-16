# usage-waste

每次你提交 prompt 时，后台自动把同样的内容通过 `claude --bare -p` 发到你指定的 API endpoint，刷用量。同一 session 内自动续接对话。

## ⚠️ 必须配置自己的 API Key 和 Base URL

> **两个都不配，插件不会运行。**
>
> 如果你填了自己主账号的 key，**消耗的是你自己的额度**。
> 请使用专门用于刷量的 key。

## 安装

```bash
git clone https://github.com/eddiearc/usage-waste.git
cd usage-waste
bash scripts/setup.sh --api-key sk-ant-xxx --base-url https://your-endpoint.com
```

setup.sh 会自动完成：
1. 复制 hook 脚本到 `~/.config/usage-waste/scripts/`
2. 检测已安装的 agent（Claude Code / Codex），注入 hook 到对应配置文件
3. 写入环境变量到 shell profile（`~/.zshrc` 或 `~/.bashrc`）
4. 运行验证，确认 stats.json 正常写入

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `--api-key <key>` | 是 | API key |
| `--base-url <url>` | 是 | API endpoint |
| `--model <model>` | 否 | 默认 sonnet |
| `--host <targets>` | 否 | 逗号分隔，如 `claude,codex`。不填则自动检测 |

安装后**重启 agent** 让 hook 生效。

## 验证

```bash
bash scripts/status.sh
```

| 状态 | 含义 |
|---|---|
| stats.jsonl 不存在 | hook 没触发过（agent 没重启？） |
| status.json 显示 `skipped` | hook 触发了但缺环境变量 |
| stats.jsonl 有记录 | 正常运行中，看 success/failed |

## 查看用量

```bash
bash scripts/status.sh
```

输出示例：

```
Stats:
  Total calls: 42 (success: 40, failed: 2, rate: 95.2%)

Tokens:
  Input:          12,345
  Output:         3,456
  Total:          15,801
  Cost:           $0.1234

Breakdown:
  By model:
    sonnet: 42
  Sessions (3 total, last 5):
    abc123: 20 calls, 8,000 tokens, $0.0600
    def456: 15 calls, 5,000 tokens, $0.0400
```

数据存储在 `~/.config/usage-waste/stats.jsonl`（每次调用 append 一行，并发安全）。
```

## 防递归

两层保护防止 hook 无限循环：

1. **`--bare` 模式**：spawned 的 `claude` 进程跳过所有 hooks
2. **`USAGE_WASTE_RUNNING=1`**：子进程带此环境变量，hook 入口处检测到直接退出
