---
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: platform-owned-skills
base_bundle: skills
scope: four-official-skills-globally-visible-via-platform-org-rls-read-policy-no-fork-needed
covers: []   # 待人类/harness 回填 F 号
confirmed_by: usamshen
confirmed_at: 2026-08-27T13:59:23+00:00
confirmed_via: "手工——chat 里对签核清单①②③④逐条打包确认后回复「yes」。⚠ 本文件是
  重建版：原件与同轮的 phase-13 scaffold 在同一次会话的 /tmp 环境被意外清空前只落在
  worktree 本地、从未提交，随环境一起丢失（skill-lazy-loading 那份 delta 因为已经
  commit+push+PR#2237 合并而完好无损，platform-owned-skills 这份没有）。签核时间/
  签核人/签核内容照原文重建，不是重新走一次签核——人类的原始确认是真实发生过的
  事实，只是记录它的文件需要重打一份。"
---

# design delta 签核 · 平台级 skill 全局可见

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类明确指出"这些 skill 应该是所有的 org 都可以用的，不需要导入到任何的 org，
请检查现在的系统逻辑"。检查确认现状确实如此——四个官方 skill（pptx-create/
docx-create/xlsx-create/pdf-create）即使做完了，也只有真的走 starter-pack 导入过的
那一个 org 能用（`contract.md` §0）。

## 签核前确认过的四条（已通过）

- **① 范围：只有本仓官方四个 skill 平台化，不是"所有 skill"**。用户/组织自己
  导入的第三方 skill **依然严格按 org 隔离**，不会因为这个机制存在就默认放宽
  （`contract.md` §3/§5，V5 有专门反证）。
- **② 机制：直接复用 canvas 模板已经用过的 platform-org RLS 模式**（额外的
  `FOR SELECT` 策略 + 查询层 `OR org_id = PLATFORM_ORG_ID`），**不是**新发明
  一套。且与 canvas 模板不同——skill 不需要"用时 fork"这一步（`contract.md`
  §2：`thread_skill_mounts` 的复合外键已经在 #1534 被 drop 掉，改成应用层校验，
  没有 FK 层面的阻碍），实现比 canvas 模板更简单。
- **③ 只放宽读，不放宽写**：新增策略全部是 `FOR SELECT`，与既有的按租户
  `FOR ALL` 策略并存。任何组织依然**改不了、删不了**平台行（V4 专门验证）。
- **④ backfill 脚本人工触发，不进任何自动化流程**：同 `backfill-platform-org.ts`/
  `backfill-canvas-builtin-templates.ts` 先例，避免"每个跑过这份迁移的库都无条件
  多出四个 skill"这类 2026-08-26 已经真实发生过一次的事故。

## 与既有已签内容的关系

- **不改** `skill-office-docs-node-runtime`（F979）/`skill-sandbox-execution`（F962）
  已签的 skill 正文、执行机制、隔离边界——四个 skill 的内容与怎么执行一个字不变，
  只改"谁能看到/挂载它们"。
- **不改** `skill-lazy-loading`（F979 之后签核、已随 PR #2237 合入 main）已签的
  渐进式加载机制——平台行的 `SKILL.md` 全文，跟组织自有行一样，走目录+按需展开
  那一套，不区分来源。
- **不改** `platform_canvas_template_library`（B2 全局母版+用时 fork）已签的设计
  ——只是**复用**它建立的 `PLATFORM_ORG_ID`/`org-platform` 这个既有事实，不重新
  定义"什么是平台组织"。
