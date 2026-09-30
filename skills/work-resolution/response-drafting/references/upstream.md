# upstream —— 回复起草（S015）

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `customer-support/skills/draft-response/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`customer-support/LICENSE`） | adapt，`copied=false`：采用「草稿 + 仅内部可见的备注」分层、「不做超出授权的承诺」「不外泄不可公开的路线图」检查项、按渠道控制长度；不采用「生成后主动提供改写选项」与按客户合作时长调语气的经验阈值 |
| github/awesome-copilot | `skills/email-drafter/SKILL.md` | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（仓根 `LICENSE`） | adapt，`copied=false`：从本人已发送邮件学习问候/结构/落款/语言；无既往样本时用默认并注明是推断；不采用最多问 3 个澄清问题的步骤 |

## NOTICE

### Apache-2.0（anthropics/knowledge-work-plugins）
按 Apache-2.0 §4 记录：本 Skill 借鉴 `customer-support/skills/draft-response/SKILL.md` 的分层与检查项思路，未复制其文字，未作修改性再分发。如后续复制任何片段，须在此追加版权与修改声明，并把 provenance 的 `copied` 改为 true 且补 `notice`。

### MIT（github/awesome-copilot）
Copyright GitHub, Inc. 本 Skill 借鉴 `email-drafter` 的风格学习思路，未复制其文字。

## 自有规则

两份上游都假设「起草者就是发送者本人」；S015 在 Workflow 中代表组织回复，因此额外引入承诺台账与受众过滤，这两块没有上游来源，是 WorkspaceX 自有规则。
