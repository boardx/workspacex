# verification · platform-owned-skills

> 每条门控配一条反证。

## V1 — 一个从未导入过任何 skill 的全新 org，能在目录里看到四个官方 skill

断言：真实建一个全新 org（无任何 skill 导入历史），调 `listSkills`/`GET /capabilities?kind=skill`，返回结果包含 `pptx-create`/`docx-create`/`xlsx-create`/`pdf-create` 四个条目，`visibility` 为 `org-wide`。

⚠ 反证：把 `listAll()`/`listByKind()` 的 `OR org_id = PLATFORM_ORG_ID` 去掉，断言必须变红（结果变空）。

## V2 — 同一个全新 org 能真的把平台 skill 挂到 thread 上

断言：`mountSkillToThread` 对平台 skill 的 `skillId` 调用成功（不是 `SKILL_NOT_FOUND`），`thread_skill_mounts` 里真的多一行，`org_id` 是这个新 org（不是 `org-platform`）。

⚠ 反证：把 `SkillVisibilityPort.visibleTo()` 只查自己 org 不查平台行，断言必须变红（`SKILL_NOT_FOUND`）。

## V3 — 挂载之后真的能执行、真的产出文件（这是最容易漏、最该测的一处）

断言：真实 chat run，挂载平台 docx-create skill，发一句真实需求，`readPinnedSkills` 真的读到平台行的 `SKILL.md` 全文（不是空/`SKILL_VERSION_UNAVAILABLE`），模型写出 `run_script`，沙箱真的执行，产出可解析的真实 `.docx`。

⚠ 反证：只加 `pg-skill-contract-repository.ts` 的 OR 子句、不加 `pg-agent-run-repository.ts` 的，断言必须变红（run 会因为 `pinned N, retrieved 0` 走 `SKILL_VERSION_UNAVAILABLE`）——这正是 contract §4③ 特意点名"最容易漏"的那一处。

## V4 — 写路径依然严格隔离：一个组织改不了/删不了平台行

断言：以某个真实组织的 admin 身份，尝试 UPDATE/DELETE 一行 `org_id='org-platform'` 的 `skills`/`skill_versions` 记录（走应用层已有的编辑用例，或直接对着这行跑既有的编辑 repo 方法），必须被拒绝（RLS 的 `_tenant` 策略仍然只认 `org_id = current_org`，新增的 `_platform_read` 策略只加了 SELECT）。

⚠ 反证：给 `_platform_read` 策略误写成 `FOR ALL` 而不是 `FOR SELECT`，这条断言必须变红（UPDATE/DELETE 会意外成功）。

## V5 — 用户自己导入的第三方 skill 依然严格按 org 隔离，不会被平台化

断言：某组织通过 URL/starter-pack 导入一个自建 skill（`org_id` 是该组织自己），另一个全新 org 的 `listAll()` 看不到它。

⚠ 反证：如果 backfill 脚本或迁移不小心把某个真实组织的 skill 误标成 `org_id='org-platform'`，这条断言会红——这是防止"平台化"范围蔓延到不该蔓延的地方的直接门控。

## V6 — backfill 脚本幂等，可安全重跑

断言：连续跑两次 `backfill-platform-skills.ts`，第二次不产生重复行（`ON CONFLICT DO NOTHING`），四个 skill 各自仍然只有一行。

⚠ 反证：去掉 `ON CONFLICT` 子句，第二次跑必须报唯一约束冲突或产生重复行——证明幂等性真的是靠约束保证的，不是脚本本身"恰好没被跑两次"。

## V7 — 端到端真实验证（devapp 或本地真栈，同 skill-lazy-loading 的 V7 纪律）

1. 跑 backfill 脚本，确认 org-platform 下真的多出四行 skill。
2. 用一个全新注册、从未做过任何 skill 导入操作的组织账号，进 chat，`#` 挂载
   docx-create——确认候选列表里真的出现它,不需要先去后台"导入"。
3. 发一句真实需求（"帮我生成一份周报 Word"),确认最终产出一个可下载、可打开、
   内容正确的 .docx。
4. 用**另一个**全新组织重复③，确认两个组织互不干扰、都能独立成功——不是"只有第一个
   跑过的组织能用,后面复用了同一份状态"这种假共享。
