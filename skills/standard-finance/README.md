# WX-S101 / standard-finance 包

一个 skill：`ic-review-standard`（上会材料审阅方法论）。

```bash
node --import tsx skills/standard-finance/scripts/build.ts
```

该脚本做两件事：① 把方法论的**唯一事实源**（`apps/web/lib/ic-review/review-prompt.ts`
经 `apps/api/scripts/ic-review-skill-content.ts` 套 frontmatter）逐字节写成
`ic-review/SKILL.md`；② 打成 `skills/starter-packs/standard-finance/1.0.0.json`。
因此**导出的就是线上真正在跑的那一份**，不是照着写的一版；漂移由
`apps/api/tests/skill/ic-review-skill-version-bump.test.ts` 机械盯住。

⚠ 本包**刻意未注册进** `STANDARD_PLATFORM_PACKS`：平台侧该 skill 已由
`ensure-platform-skill-catalog.ts` 自愈种子落库，再经 starter-pack 导一次会出现两个
同名 skill、两条版本线。本包用途是导出到别的系统（Claude Code / claude.ai /
Agent SDK），以及将来走 starter-pack 治理时的现成物料。装法见
`ic-review/references/how-to-import.md`。

## 验收边界（不要越读）

`evals/ic-review/` 的十轮评测评的是这份方法论在**不联网**条件下的表现，用 Claude
子代理作被测模型；`SUMMARY.md` 逐条写明了哪些结论经得起方差检验、哪些不能宣称。
任务四/五/六（公开信息检索、竞对对比、风险识别）**一次都没评过**。换到别的系统、
别的模型 provider 后的表现同样未验证。
