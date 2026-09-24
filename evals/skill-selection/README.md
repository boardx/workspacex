# skill-selection — 开源技能入选评审

决定哪些开源 skill 进入 WorkSpaceX 工作生态、排在哪一波。

| 文件 | 是什么 | 谁改 |
|---|---|---|
| `../../docs/proposals/PROP-EXPERT-COMMUNITY-001-skill-selection-standard.md` | 标准：研究流程、硬门、维度锚点、判定规则 | 人（评审通过后） |
| `rubric.json` | 权重、阈值、枚举的**唯一数值来源** | 人确认后改；改完重跑看敏感性 |
| `packages.json` | 来源包健康度事实与 H1/H2 | 复评时更新读数 |
| `scores/*.jsonl` | 主评审员逐 skill 评分，每个分数带证据 | 评审员 |
| `calibration/*.jsonl` | 独立第二评审员盲评样本，用于一致性检验 | 第二评审员 |
| `REPORT.md`、`ranking.csv` | 生成物：层级、波次、能力拉动、合并组、一致性、敏感性 | **只由脚本生成** |

```bash
node evals/skill-selection/score.mjs --check   # 只校验记录格式与证据完整性
node evals/skill-selection/score.mjs           # 生成 REPORT.md 与 ranking.csv
```

`ranking.csv` 带 BOM，可直接用 Excel 打开复核。
