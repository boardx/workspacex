# upstream —— 决策记账（S197）

| 项 | 内容 |
|---|---|
| 仓库 | adr/madr |
| 路径 | `template/adr-template.md`（Decision Drivers / Considered Options / Confirmation / frontmatter status） |
| commit | `ba75bb1b20d42af5746b246ad348c202419ae681` |
| 许可 | `MIT OR CC0-1.0`（与 S012 登记的同一上游；本 Skill 采用 CC0 分支） |
| 用法 | adapt，`copied=false`：只取日志条目骨架与 status 生命周期概念，不复制模板文字 |

不适合之处：MADR 面向工程架构决策，status 由作者维护；S197 面向管理决策，记录者常是 AI 或秘书，因此「谁决定」与「谁记录」分字段，状态由人确认（`confirmationState` 恒为 `awaiting-human-confirmation`）。
