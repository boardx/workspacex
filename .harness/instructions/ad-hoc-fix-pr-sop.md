# 直接交办任务的 PR 自动化 SOP（2026-09-03 人类指令）

> 适用范围：用户在对话里**直接**描述的代码改动（bug 修复、小功能点、UI 调整……），
> **不经过** `phases/<phase>/feature_list.json` 的 sprint/feature 正规流程。
> feature 的完整生命周期（issue → 分支 → verify → PR → 合入）不受本文影响，见根
> `AGENTS.md`「开发任务必须在 GitHub 上可见」——那节是权威，本文不重复其规则。

## 背景

Claude Code 的默认行为是"除非用户明确要求，否则不创建 PR"——这是**通用默认值**，
不是本仓库的选择。实测后果（2026-09-03）：一次改动验证全部通过（typecheck / lint /
相关测试全绿）、已提交推送到分支，agent 仍停下来问"要不要创建 PR"，把本该自动完成
的收尾动作变成了一次人类必须响应的中断。本仓库选择覆盖这条默认值。

## 规则

1. **验证通过 ⇒ 自动创建 PR，不要停下来问。**
   改动已 commit、push 到分支，且该改动涉及的验证命令（typecheck / lint / 受影响的
   test）全部跑绿，就直接创建 PR——把"要不要建 PR"当作已经回答过的问题，不要再问
   用户一遍。PR 描述里写清楚改了什么、为什么、验证结果（复用已发现的 PR 模板，无
   模板则按常规写法）。

2. **例外——这几种情况仍先问人，不自动建 PR：**
   - 改动范围明显超出用户原始描述（顺手改了没被要求的地方）；
   - 涉及破坏性或难以回滚的操作（删表、改权限模型、动生产配置/密钥）；
   - 验证本身跑不动或有验证项失败，还没修到全绿。

3. **PR 创建后，这个 PR 是你的，不是甩给下一个人。**
   CI 红、review 有意见，都是创建者自己跟到底：修到绿，或者明确判定"红的不是这次
   改动、已在 PR 上留言说明原因和处置"——参照本项目对"你创建的 PR"的既有要求（见
   `pr-review-merge-sop.md` 与 `coordinator-sop.md` 的 PR 状态机）。**不允许**创建完
   PR 就结束/让 session 空转，把红 PR 留给不知情的后来者。

4. **不必走完整 sprint feature 的 issue 生命周期，但仍要有 `Refs #N`。**
   Ad-hoc 任务不是 `feature_list.json` 的条目，不需要"先建 issue、issue 里记录每次
   迭代"那套完整机制（那是 sprint feature 专属）。但 `.harness/scripts/lib/pr-queue.ts`
   的 `classifyPr` 对**任何** PR 都机械检查"正文里有 `Closes #N` 或 `Refs #N`"，没有
   区分 sprint feature 与 ad-hoc（2026-09-03 #2562 实测：本文早先版本声称"不强制开
   issue"，但对应 PR 因此没有任何 issue 引用，被 `classifyPr` 判 `MERGE_BLOCKED`——
   一条不被机械判据支持的"豁免"只是一句不成立的承诺）。所以：**开一个轻量 issue、
   PR 正文写 `Refs #<issue>` 即可**——不必是 `Closes`，不必先有它才能动手改代码，成本
   是几秒钟的一次 API 调用，不是完整 sprint 生命周期。

## 与已有规则的关系

- 「PR 绿了才算完」的唯一判定仍是 `.harness/scripts/lib/pr-queue.ts` 的
  `classifyPr`（内部复用 `classifyChecks` 判 CI 部分）——本文不新定义、不复述任何
  check 或 issue 追溯性规则，本节第 4 条只是指出既有判据同样适用于 ad-hoc PR。
- 本文只解决"要不要主动创建 PR"这一个决策点；PR 创建之后的分诊、合并、review 判定，
  全部沿用 `coordinator-sop.md` / `pr-review-merge-sop.md` 既有流程，没有新增例外。
