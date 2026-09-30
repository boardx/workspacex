# upstream —— 根因分析（S011）

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| github/awesome-copilot | `skills/incident-postmortem/SKILL.md`（Step 3 Root Cause Analysis；root cause vs contributing factors；Anti-patterns 表） | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（仓根 `LICENSE`，Copyright GitHub, Inc.；该 SKILL.md frontmatter 无 license 字段，按仓根许可处理） | adapt，`copied=false`：采纳「停在可修复的系统/流程缺口」「人为失误永远是症状」「时间线要对日志而非凭记忆」三条判据，写成步骤 3、6 的机器可判规则；不复制正文 |
| anthropics/knowledge-work-plugins | `engineering/skills/incident-response/SKILL.md`（第 115–123 行 Root Cause / 5 Whys 模板段） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓根 `LICENSE`；插件目录无单独 LICENSE） | adapt，`copied=false`：借鉴把 RCA 放在事件处置「之后」的阶段划分（W056 中 S177 → S011） |

## NOTICE

### MIT（github/awesome-copilot）
Copyright GitHub, Inc. 本 Skill 改编其 `incident-postmortem` 的判据思路；未复制其文字。

### Apache-2.0（anthropics/knowledge-work-plugins）
按 Apache-2.0 §4 记录：本 Skill 借鉴 `engineering/skills/incident-response/SKILL.md` 的阶段划分思路；未复制其文字，未作修改性再分发。如后续复制任何片段，须在此追加版权与修改声明，并把 provenance 的 `copied` 改为 true 且补 `notice`。

## 合并点

两个仓库源都把 RCA 写成线性 5 Whys 的散文，没有「假设是否被检验过」的状态，也没有区分「引发」与「未能拦截」（escape）。S011 的合并点：KT 的 IS/IS NOT 做假设淘汰 + DAG 表达多因 + 每条因果边带检验状态 + 8D 的 occurrence / escape 双根因。
