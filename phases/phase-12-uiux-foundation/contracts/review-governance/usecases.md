# 契约束 `review-governance` — 签核②：用例接口

> 本束**无面向前端消费者的后端 API 契约面**——`ReviewRecord` 落盘的是 `.harness/state/`
> 下的内部治理数据，不经由 `packages/contracts/src/*.ts` 暴露给 apps/web。第③件签核
> 材料记录为「不适用」。

## UC-1：写入一条评审记录
```
in:  { target: string, rubric: string, dimensionScores: Record<string, number>, deductionNotes: string[] }
out: { record: ReviewRecord, appended: true }
pre: dimensionScores 的键必须 ∈ 目标 rubric 声明的维度集合
err: SCORE_SCHEMA_MISMATCH — 传入维度不在 rubric 声明范围内
err: UNPARSEABLE_HISTORY — 历史 git log 回填时某条记录无法可靠解析，标注为「未能回填」而非编造
```

## UC-2：统计最常反复扣分维度
```
in:  { topN: number }
out: { ranked: { dimension: string, count: number }[], sampleSize: number }
pre: uiux-review-log.jsonl 至少存在（可以是刚建、样本量为 0）
err: SAMPLE_TOO_SMALL — 样本量过小时如实标注 sampleSize，不包装成「趋势结论」
```

## UC-3：正式截图级保真度评审
```
in:  { target: "chat-main" | "profile" | "org-admin", rubricPath: string }
out: { record: ReviewRecord, passed: boolean }
pre: 评审必须由 rev-uiux 角色基于真实截图执行（AGENTS.md 硬规则，agent 不许只读源码打分）
err: DATA_GAP_FOUND — 评审中发现某维度对应的产品数据不存在，参照 #831/#728 先例，
     移除该维度重算而非伪造数据（需要人类确认移除是否合理，不能由评审 agent 自行裁定）
```

## UC-4：全站终验收官
```
in:  无（读取 F01-F15 全部 passing 状态 + 前序验证脚本）
out: { report: FinalVerificationReport, allPassed: boolean }
pre: F01-F15 均已 passing
err: REGRESSION_FOUND — 某项机械门控出现回归，打回对应 feature 而非在本 feature 内静默修复
err: UNCLOSED_GAP — 某维度受产品功能缺口限制无法在本阶段闭合，如实记录为下一阶段待办
```
