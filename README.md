# usage-waste

每次你提交 prompt 时，后台自动把同样的内容通过 `claude --bare -p` 发到你指定的 API endpoint，刷用量。同一 session 内自动续接对话。

## 使用场景

某些公司给员工分配了 API key 和 endpoint，按 token 用量考核"AI 使用率"，但实际提供的模型又拉胯（比如只给最便宜的小模型）。员工面临的困境：

**公司的逻辑：**
- 花钱买了 API 额度，要求员工"积极使用 AI 提效"
- 用 dashboard 监控每个人的 token 消耗量
- 用量低 = "没有拥抱 AI" = 绩效扣分

**员工的现实：**
- 分配的模型太弱，回答质量不行，实际没法用
- 自己掏钱用好模型干活，公司分配的额度白放着
- 但用量报表上显示你"不积极"

**usage-waste 解决的问题：**

你在 Claude Code / Codex 里正常用自己的好模型干活，每次提交 prompt 时，插件自动在后台把同样的内容发到公司分配的 endpoint。你什么都不用多做：

- 公司的 dashboard 上你的用量正常增长
- 实际干活用的是你自己选择的好模型
- token 统计、成功率、费用本地可查
- 公司的 key 和 endpoint 通过环境变量配置，不会泄露到别处

**一句话总结：用好模型干活，用烂模型交差。**

## ⚠️ 必须配置自己的 API Key 和 Base URL

> **两个都不配，插件不会运行。**
>
> 如果你填了自己主账号的 key，**消耗的是你自己的额度**。
> 请使用专门用于刷量的 key。

## 快速开始

```bash
git clone https://github.com/eddiearc/usage-waste.git
cd usage-waste
bash scripts/setup.sh --api-key sk-ant-xxx --base-url https://your-endpoint.com
# 重启 Claude Code / Codex 让 hook 生效
```

## 操作手册

### 1. 安装 — `setup.sh`

```bash
bash scripts/setup.sh --api-key <key> --base-url <url> [--model <model>] [--host <targets>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--api-key <key>` | 是 | API key |
| `--base-url <url>` | 是 | API endpoint |
| `--model <model>` | 否 | 默认 sonnet |
| `--host <targets>` | 否 | 逗号分隔，如 `claude,codex`。不填则自动检测 |

自动完成：
1. 复制 hook 脚本到 `~/.config/usage-waste/scripts/`
2. 检测已安装的 agent（Claude Code / Codex），注入 hook 到对应配置文件
3. 写入环境变量到 shell profile（`~/.zshrc` 或 `~/.bashrc`）
4. 运行验证，确认日志正常写入

安装后**重启 agent** 让 hook 生效。

### 2. 查看状态和用量 — `status.sh`

```bash
bash scripts/status.sh             # 最近 7 天
bash scripts/status.sh --days 1    # 只看今天
bash scripts/status.sh --days 30   # 最近 30 天
bash scripts/status.sh --all       # 全量
```

输出内容：
- 环境变量（API Key 加密显示）
- Hook 注册状态（Claude Code / Codex）
- 调用统计（总数、成功、失败、成功率）
- Token 用量（input、output、cache、总计、费用）
- 按 model / 日期 / session 分组明细
- 最近错误记录

输出示例：

```
Stats (last 7 days):
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

### 3. 卸载 — `uninstall.sh`

```bash
bash scripts/uninstall.sh                    # 全部清理
bash scripts/uninstall.sh --keep-stats       # 保留日志数据
bash scripts/uninstall.sh --host claude      # 只卸载 Claude Code 的 hook
bash scripts/uninstall.sh --host codex       # 只卸载 Codex 的 hook
```

自动完成：
1. 从 Claude Code / Codex 配置中移除 usage-waste hook（只删自己的，不动别的）
2. 从 shell profile 中移除 `USAGE_WASTE_*` 环境变量
3. 删除 `~/.config/usage-waste/` 下的脚本、session、日志
4. 逐项验证移除结果

## 文件说明

```
scripts/
├── setup.sh                # 用户操作：安装
├── status.sh               # 用户操作：查看状态和用量
├── uninstall.sh            # 用户操作：卸载
├── usage-waste-hook.mjs    # 内部：hook 入口，被 agent 自动触发
└── usage-waste-runner.mjs  # 内部：后台 runner，被 hook spawn
```

安装后的本地文件：

```
~/.config/usage-waste/
├── scripts/                # hook 脚本副本
├── sessions/               # session 映射（续接对话用）
├── logs/                   # 按天分片的 JSONL 日志
│   ├── 2026-04-14.jsonl
│   ├── 2026-04-15.jsonl
│   └── 2026-04-16.jsonl
└── status.json             # hook 运行状态（skipped/active）
```

## 防递归

两层保护防止 hook 无限循环：

1. **`--bare` 模式**：spawned 的 `claude` 进程跳过所有 hooks
2. **`USAGE_WASTE_RUNNING=1`**：子进程带此环境变量，hook 入口处检测到直接退出
