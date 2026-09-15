---
bundle: postinvest-rating
phase: "16"
covers: [F01, F02, F03, F04, F05, F06, F07, F08]
status: pending
---

# 契约束 `postinvest-rating` 设计签核

覆盖：F01（skill 包 + 确定性脚本）、F02（契约单源）、F03（`/agent/team2` 工作台三态 UI）、
F04（阶段二编排真栈接线）、F05（历史对比与记忆）、F06（受限渠道行业背景）、F07（反馈闭环）、
F08（定期触发 + HITL 降级卡）。本阶段只有这一束：八个 feature 的不变量互相依赖
（版本链 ← 反馈分流 ← 记录实体 ← 脚本可复现），拆开会出现「A 束签了，B 束发现 A 的不变量不够用」。
判据单一事实源：`requirements/01-postinvest-rating-agent.md` 的 R3 / R4 / R5 / R7 / R10 / R12。

## 一、材料清单

- ① UI：`ui.md`（由 ui-prototyper 产出，引用 `phases/phase-16-postinvest-rating-agent/ui-preview/` 截图；
  空态 / 运行态 / 结果态 + HITL 卡 + 反馈弹层）。
- ② 用例：`usecases.md`（UC-1～UC-8 契约操作 + IUC-0～IUC-9 Agent 内部用例 + E1–E9 终态对照）。
- ③ API 契约：`packages/contracts/src/postinvest-rating.ts`（八个操作、十五个错误码、D2 种子域）。
- 支撑·领域模型：`domain.md`（I-1～I-15，每条标注强制位置）。
- 支撑·覆盖证明：`coverage.md`（R12 八条 → API → testid 双向表）。

## 二、人类签核时请重点核对

1. **①UI**：三态 + `rating-hitl-card` + `rating-feedback-dialog` 是否都有截图；结论卡四字段
   （等级 / 颜色 token / 含义 / 建议）是否**逐字从 skill 包投影**、前端没有另写一份映射（R7-1、I-10）。
2. **②失败模式**：E1–E9 每条都有 run 终态 + 页面落点（`usecases.md` 末表）；首评的 E1/E3/E5/E6/E9
   走 SSE 而不在 `createRatingRun.err`——这个「首评失败在事件流、重算失败在 HTTP 错误码」的
   分工是否可接受。
3. **③API 契约 — 已定决定 D1–D5 的编码是否如实**：
   - D1 `/agent/team2`：契约不定义路由，run 走 `agent-runtime`，**不新开第二条执行链路**。
   - D2 白名单：种子 `TRUSTED_SOURCE_SEED_DOMAINS` 八个域 + 被评公司官网按项目登记；
     `TrustedSourceDomain` 正则只收**小写裸域名**，匹配 = 精确 / 子域，无路径级规则。
   - D3 偏差阈值：**不进契约**，验收只断言机制——请确认没有任何 feature 验收依赖命中率。
   - D4 `skills/standard-finance/postinvest-rating/`：`scriptVersion` + `inputFiles[].sha256` 构成可复现（I-13）。
   - D5 录音走 `files.uploadArtifact`：**请核对这条对账**——`chat-file-upload` 白名单**已含**
     `audio/wav` / `audio/mpeg`（wav / mp3）、不含 m4a；D5 不改那份白名单（改要重签），
     而是让本 Agent 的上传区对**所有**音频一律走原件路径，误走聊天路径回 `AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD`。
     后果：同一个 wav 文件在聊天里能传、在评级工作台里被拒——这是刻意的（两条路径各一套口径的代价更高），
     请确认接受。
4. **不变量**：
   - I-11 **行业背景不改分**：白名单检索有 / 无 / 失败三种情况 `ScoreBreakdown` 逐位相等（F06 测试）。
   - I-5 **主观偏差只记录**：`subjective ⇒ recorded_only ∧ 无 newRecordId ∧ 版本不变 ∧ 规则不变`——
     这是 MAAU「防退化」的机械表达，请确认它是不变量而不是规则（能写成断言：是）。
   - I-10 **阈值只在 skill 包**：请抽查契约文件与本束四份 `.md` 里没有任何数值阈值 / 分级文案。
   - I-6 `grade = null ⇔ NO_FINANCIAL_STATEMENT` 路径：与待决 1 绑定。
5. **F04 体量**（8 点）：它一个 feature 覆盖 IUC-1～IUC-4 + IUC-7 五个内部用例 + E1/E3/E9 三条异常，
   是本束最大的一块。`R11` 已按「一次会话能做完」切，但请确认是否要把 IUC-7（发布 + E9 读取校验）拆出去；
   F05 / F06 / F07 各自只接一个内部用例，体量正常。
6. **coverage 双向**：R12 原文未编号，`coverage.md` 用派生索引 V1–V8；八个操作无孤儿。

## 三、待决（签核前需人类拍板，agent 不自行选边）

1. **A1 双路径二选一**：只有录音没报表时，`createRatingRun` 是**直接拒**（`NO_FINANCIAL_STATEMENT`）还是
   **接受并产出 `grade = null` 的「数据需求说明」记录**？契约注释两条都留着，实现只能选一条做默认。
2. **失败 run 的占位记录**：创建即占位（`CreateRatingRunOutput.recordId`）意味着 E3 / E4 失败后留下一条
   永远 `draft`、无分数的记录占住版本号。接受（A6 恢复靠它）还是回收？影响 I-4「无空洞」的措辞。
3. **白名单管理界面**：`updateTrustedSourceWhitelist` 是 admin 写操作，R8 没有给它 testid。是本期只走
   API / 后台既有设置页，还是要进 `ui.md` 补一屏？
4. **`confirmRatingRecord` 对未出分记录**：run 仍在跑或已 failed 的占位记录被采纳，契约无专用码
   （现落 409 通用）。是否补 `RECORD_NOT_RATED`？
5. **`decideRatingHitl.note` 驳回是否必填**：契约 `note` 可选；R3-11 写「驳回并说明」。若必填，需补错误码。
6. **`MissingDataReason.otherText`**：`reasons` 含 `other` 而 `otherText` 缺席现落 400 通用校验（契约不用 refine）。
   是否需要具名错误码。

签核前本束 `status: pending`；以上待决由人类在本文件或对应 issue 里逐条裁决后，agent 才改契约 / 用例文本，
`status` / `confirmed_by` / `confirmed_at` 一字不动（ADR-023 决策五）。
