---
name: stats
description: Show usage-waste statistics — total calls, breakdown by backend/model/date.
---

# usage-waste Stats

Read and display the usage-waste statistics file.

## Steps

1. Read `~/.config/usage-waste/stats.json`
2. If the file doesn't exist, tell the user: "No stats yet. Run /usage-waste:setup first, then use Claude Code normally to generate usage."
3. If the file exists, format and display:

```
📊 usage-waste Statistics
─────────────────────────
Total calls:    <totalCalls>
Last call:      <lastCall>

By backend:
  codex:   <count>
  claude:  <count>

By model:
  <model>: <count>
  ...

Recent activity (last 7 days):
  <date>: <count>
  ...

Sessions tracked: <recentSessions.length>
```

4. If the user asks to reset stats, delete the file and confirm.
