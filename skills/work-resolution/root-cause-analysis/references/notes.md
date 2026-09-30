# references —— 根因分析（S011）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S011-root-cause-analysis.md`）。词表与类别表是规格 §14 点名的 references，各自是**单一事实源**：
`blameless-lexicon.md`（O5 / 规则 (c)）、`vague-action-lexicon.md`（F9 / O15 / E10）、`categories.md`（步骤 4）、`regimes.md`（§11 法规出处与复核记录）、`upstream.md`（MIT + Apache-2.0）。评测 grader 读取同两份词表，不另抄。

## 规格静默处的实现取舍（评审请确认）

- 规格 §5 的 zod 输入里 `isNot` / `timeline` / `regimeFlags` 带默认值，JSON Schema 中写成可选字段。
- `E12` 拆为 E12（成功报告 schema）与 E12B（错误路径夹具，deterministic=false，保持 G5 分母 12）；E13/E14 是 Workflow 套件的集成断言，本套件不含。
- 补充用例 P1（证据无读权限 → `S011_EVIDENCE_NOT_READABLE`）为 deterministic=false，不计入 G4/G5 分母，仅为 G3 权限覆盖；E6（受众 customer 的脱敏）另标 permission-denial。
- 评测必过集合 `mustPassCaseIds = E2/E3/E5/E7`：取自规格 §13 明文。
- 两份词表的词条由实现者按规格 F2/F9/E10 与「人为失误」常见表达初拟，规格只给了样例词；内容待评审补全（词表只影响「命中则追问/提问」，不影响图求值）。
- grader 带同一套判定实现（图求值、C/F 集合、判定表、O1–O15），是规格 §14 「兜底校验器」的评测侧版本；服务端输出校验层仍是 declared-but-unwired。
