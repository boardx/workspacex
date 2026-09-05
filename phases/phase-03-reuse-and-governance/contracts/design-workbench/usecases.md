# 契约束 `design-workbench` — 签核第 ② 件：用例

> 补写材料（B4.6 之后由 doctor [03] 签核链检查要求补齐——`design-signoff.md` §② 原文
> 说明本束"没有独立的 usecases.md"，把这条决策留给签核时的人类判断；ADR-023 决策二把
> 这类支撑材料"降级为不阻塞签核，但不得删除"，本文件把已经存在于契约文件头注和
> `coverage.md` 里的用例决策收拢成独立文件，不新增产品决策。）

覆盖 feature：**B4.1 B4.2 B4.3 B4.4 B4.5 B4.6**，见 `design-signoff.md` frontmatter 的
`covers:`（权威）。规范来源：`uc-17-8-研发闭环-反馈到设计到排期.md` R4.4 +
`uc-17-8-go-live-backlog.md` §B4。

## UC-B4.1 · PM/运营从工作台首页新建一个设计项目

**主角**：PM/运营角色成员。

1. 首页三张模板卡片（`mobile`/`ui`/`wireframe`）任选一张进入新建弹窗。
2. 填名称（必填，1–200 字）、可选背景描述。
3. 提交 → 服务端按 `DESIGN_PROJECT_INITIAL_CRITERIA`/`DESIGN_PROJECT_INITIAL_FRAMES`
   填入验收标准与画布标签快照，`chat` 恒为 `[]`——这三项**不接受前端传入**。
4. 生成中过渡等待 `createProject` 真实返回，失败退回弹窗提示。

**V1**：名称空值不可提交（`NAME_REQUIRED`）。
**V2**：验收标准/画布标签是创建时的快照，不是常量引用——默认文案改版不影响已建项目。

## UC-B4.2/B4.3 · 编辑、删除、推送到收件箱

**主角**：项目 owner。

1. 编辑只改名称/模板/背景，`criteria`/`frames`/`chat` 不在编辑范围。
2. 删除硬删，已推送的项目也可删。
3. 推送到收件箱：写 `pushed`/`pushedAt`/`note`，生成收件箱条目编号 `inboxCode`；
   若本项目 `linkedFeedbackId` 非空，同一事务回写源反馈的 `resolved_by_design_id`。

**V3**：非 owner 调用改/删/推送 → `NOT_PROJECT_OWNER`；读操作不受此限（见 `domain.md` §3）。
**V4**：重复推送是 upsert，不是错误——见 `domain.md` §4。

## UC-B4.4 · 从一条反馈「深化」出设计项目

**主角**：PM/运营角色成员，在收件箱看到一条反馈后选择「用 PM 设计工作台深化」。

1. 服务端先校验请求者对该反馈有 D3 正文可见权（看不到正文不可能有意义地深化）。
2. 校验通过后新建项目，`problem` 抄入反馈正文，`linkedFeedbackId` = 源反馈 id。

**V5**：源反馈不存在/不在本组织 → `FEEDBACK_NOT_FOUND`（404 语义，不泄露存在性）。
**V6**：请求者无正文可见权 → `FEEDBACK_DETAIL_NOT_VISIBLE`。

## UC-B4.5 · 详情页对话协作

**主角**：项目 owner 或组织内其他成员（可见性口径见 `domain.md` §3）。

1. 详情页左侧固定对话面板，`chat` 为空时前端本地渲染 `DESIGN_WORKBENCH_CHAT_INTRO`
   （展示层文案，不落库——见契约文件头【待确认点 2】）。
2. 发送一条消息，服务端原子写「用户消息 + 固定回执 `DESIGN_WORKBENCH_CHAT_REPLY`」两条
   （D7 已裁决：先固定回执，不接真模型）。

**V7**：引导语不是 `chat` 的第一条记录——用户发的第一条消息在数据库里确实是第一条。

## UC-B4.6 · 收件箱侧的「已生成方案」徽标

**主角**：任何能看到收件箱的成员。

1. 一条反馈被深化并推送后，其收件箱卡片显示「已生成方案」徽标，指向生成的设计项目。
2. 徽标依据 `InboxItem.resolvedByDesignId !== null` 判定（见 `domain.md` §2 的双向关联）。

**V8**：`resolvedByDesignId` 是恒对全组织可见的展示性事实（同 `title`/`votes`），
不随 D3 门控收窄——即使正文不可见的行，也应该能看到"这条反馈已生成方案"这件事本身。

---

见 `coverage.md` 的 UC↔API 双向映射表获取每条用例对应的具体接口与前端消费点。
