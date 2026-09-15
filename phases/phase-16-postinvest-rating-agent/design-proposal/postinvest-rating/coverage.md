# 契约束 `postinvest-rating` — UC 覆盖证明（支撑材料）

> R12 验收线索来自 `requirements/01-postinvest-rating-agent.md#R12`（单一事实源）。
> ⚠ R12 原文是八条**未编号**的要点；下表的 `V1`–`V8` 是本文件按原文顺序给的**派生索引**
> （门控要求以 R12 编号为行键），不改 UC 原文、不是第二份事实源。「一句话」列逐条对应原文要点。
> 前端 `data-testid` 来自 R8（签核第 ① 件 `ui.md` 由 ui-prototyper 落地，本表只引用名字）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 成功态：上传报表 → 出 A–E 结论卡 + 依据表 + 三种产物可下载；同一输入重跑得分逐位一致；结论卡四字段与 skill 包分级表逐字一致 | `createRatingRun` → `getRatingRecord`（`gradeMeta` / `evidence` / `reports[].verified`）；逐位一致由 F01 `scoring-determinism.test.ts` 断言（I-1） | `rating-upload-dropzone` `rating-start-button` `rating-run-progress` `rating-result-card` `rating-tab-evidence` `rating-evidence-row-<n>` `rating-tab-reports` `rating-report-<kind>`（pdf / xlsx / png） | ✅ 契约闭合 |
| V2 | 数据质量七种分支（PDF 表每一行各一例）各自产生正确标注 / 分数 / 直接 E | `createRatingRun.in.missingData`（A1–A3 的人工事实）→ `getRatingRecord.out.flags` / `grade`；分支判定在 skill 包（F01 `fixtures-coverage`），契约只带回 `DataQualityFlag` | `rating-missing-reason-form` `rating-missing-reason-<code>` `rating-flag-<code>` `rating-result-card` | ✅ 契约闭合 |
| V3 | 两条降级触发各一例，且触发前出现 HITL 确认卡 | `decideRatingHitl`（approve / reject）；触发判定在 skill 包脚本（IUC-4），中断在 `deep-agent-hitl` 束 | `rating-hitl-card` `rating-hitl-approve` `rating-hitl-reject` | ✅ 契约闭合 |
| V4 | 异常态 E1–E9 各自的页面表现与 run 终态 | `createRatingRun.err`（E4 `KERNEL_UNAVAILABLE`、E8 `ORG_NOT_ELIGIBLE` / `NO_PROJECT_ROLE`）；`submitFeedback.err`（E1 `PARSE_FAILED`、E3 沙箱三码、E7 `rerun_started`）；`getRatingRecord.out`（E2 `suspected_abnormal`、E5 / E6 `uncertainties`、E9 `reports[].verified=false`）；首评的 E1/E3/E5/E6/E9 经 SSE（`streaming-transport` 束） | `rating-upload-item-<n>`（E1 解析状态）`rating-run-progress`（E3 / E4 错误 + 重试）`rating-tab-uncertainty`（E5 / E6）`rating-version-list`（E7）`rating-report-*`（E9 未验证 `aria-disabled`）；E8 无消费点（入口不渲染、直达 404） | ✅ 契约闭合 |
| V5 | 反馈五类：四类产生新版本且修正记录进记忆；主观偏差不产生新版本且页面回显「已记录，评级不变」 | `submitFeedback`（`outcome` / `newRecordId`，I-5）→ `listRatingRecords`（版本 +1）；记忆写入 IUC-8（`wx_memory_write`，API 层验收） | `rating-feedback-button-<n>` `rating-feedback-dialog` `rating-feedback-type-<code>` `rating-feedback-submit` `rating-feedback-recorded-only` `rating-version-list` `rating-version-<n>` | ✅ 契约闭合 |
| V6 | 权限态：项目成员可用；admin 不能采纳；非 Workspace 组织入口不可见、直达 404 | `confirmRatingRecord`（`ADMIN_CANNOT_CONFIRM`）；全部操作的 `NO_PROJECT_ROLE` / `ORG_NOT_ELIGIBLE`（对外 404） | `rating-confirm-button` `rating-status-badge`；入口可见性 `lib/navigation.ts` `isAgentsNavVisibleForOrg`（既有，非本束新增） | ✅ 契约闭合 |
| V7 | 安全态：`web_search` 查询词不含财务数值；非白名单域名结果被丢弃且计数出现在不确定性 Tab | `getTrustedSourceWhitelist` / `updateTrustedSourceWhitelist`（白名单单源）→ `getRatingRecord.out.discardedOffWhitelistCount`；查询词约束在 IUC-6（F06 测试，API 层验收） | `rating-tab-uncertainty`（丢弃计数）；白名单管理界面本期无独立屏（admin 编辑面 ⚠ 待裁：是否进 `ui.md`，见 design-signoff 待决 3） | ✅ 契约闭合 |
| V8 | 可追溯：任一评级记录可回指 run id、输入 SHA256、脚本版本 | `getRatingRecord.out.runId` / `inputFiles[].sha256` / `scores.scriptVersion`（I-13）；`listRatingRecords` 定位任一版本 | `rating-version-<n>` `rating-upload-item-<n>`（SHA256 缩略）`rating-tab-evidence` | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 | 其它出处 |
|---|---|---|
| `createRatingRun` | V1 V2 V4 | R2 触发 1 / 3、R3-1 ~ R3-4、A1–A3、A6 |
| `getRatingRecord` | V1 V2 V4 V7 V8 | R3-12、A6 恢复 |
| `listRatingRecords` | V5 V8 | R3-1 历史列表、R3-15 版本链、A5、A6、R5 lead 组合视角 |
| `submitFeedback` | V4（E1 / E3 / E7）V5 | R2 触发 2、R3-13 ~ R3-15、R7-6 |
| `confirmRatingRecord` | V6 | R3-16、R7-7 |
| `getTrustedSourceWhitelist` | V7 | R3-10、A7、D2（编排 IUC-6 也读它） |
| `updateTrustedSourceWhitelist` | V7 | R5 admin、D2 |
| `decideRatingHitl` | V3 | R3-11、A4（本期 / 上期指定）、R7-5 |

无孤儿操作：八个操作每个至少被一条 R12 需要。`listRatingRecords` 与 `getTrustedSourceWhitelist`
在 R12 里是间接需要（版本链 / 白名单单源），已在「其它出处」列出原文依据，不代表接口多余。

## 三、R12 里不落在本束 API 上的部分（诚实标注，不是缺口）

- V1「同一输入重跑逐位一致」、V2「七种分支各一例」：判定在 skill 包（F01），契约只带回结果形状。
- V3「触发前出现 HITL 卡」的中断机制：`deep-agent-hitl` 束；本束只有裁决入口。
- V4 首评的 E1 / E3 / E5 / E6 / E9：经 SSE 事件流（`streaming-transport` 束）呈现，`createRatingRun.err` 不含它们（契约注释已说明）。
- V5「修正记录进记忆」、V7「查询词不含财务数值」：Agent 编排层行为（IUC-6 / IUC-8），由 F05 / F06 测试在 API 层验收。
- V6「入口不可见」：`lib/navigation.ts` 既有规则，本束不新增。
