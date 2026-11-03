# Skill / Agent 本地化实施设计（国际化三期）

状态：原始实施建议及后续跟踪，非人类签核。追踪：[#6135](https://github.com/boardx/workspacex/issues/6135)。
用户于 2026-11-03 的最新授权为三期并行实施，不等待前序合并才开发；下文的依赖顺序仅用于集成和合并。
自动合并由已授权 coordinator 按最新 head 检查、分类器和分支保护执行，worker 不因此自行取得合并角色。
实现与证据分别见共享契约 [#6142](https://github.com/boardx/workspacex/pull/6142)、
存储/API [#6151](https://github.com/boardx/workspacex/pull/6151)、管理/展示 [#6149](https://github.com/boardx/workspacex/issues/6149)；
官方双语包元数据与便携导入/导出继续跟踪 [#6156](https://github.com/boardx/workspacex/issues/6156)。
合并/发布状态读这些对象的实时信号，不从本设计文档推断。
以下保留原始设计依据；字段与行为以 `packages/contracts/src/entity-localization.ts`、实际迁移和实现为权威。

## 范围与事实依据

源字段保留，翻译独立存储；稳定标识和执行快照不因界面语言改变。
审计详情见 issue；准备基线 `151526a4f8dea1ad781d709ab8e3357f52714a96`（origin/develop）。
已 fetch origin main/develop，不在共享 checkout 切分支或合并。

- `packages/contracts/src/wave2-runtime.ts` 的 v1 导入条目 strict，不接受任意新增字段。
- `apps/api/src/domain/skill/skill-frontmatter.ts` 中 SKILL.md name 是 stable_name，不能翻译。
- `apps/api/src/infrastructure/agent/agent-version-insert.ts` 是 Agent 版本插入单点，角色字段冻结。
- `apps/api/src/infrastructure/agent/pg-agent-directory-repository.ts` 聚合主表、发布版本和 capability_listings。
- `apps/api/src/infrastructure/skill/pg-work-skill-catalog-repository.ts` 从发布 manifest 取简介。
- `apps/api/src/application/agent-run/skill-catalog.ts` 的模型目录从固定正文派生摘要，不接 UI resolver。
- `apps/web/lib/work-skill-display-copy.ts` 将 S061 等技术名称映射成人类名称。
  三期不能把编号当成中文显示名，官方包应作者化展示元数据并替代该映射。
- `apps/web/lib/workflow-display-copy.ts` 的静态阶段标签归二期，不覆盖用户自由命名标题。

## 一、兼容迁移设计

实际迁移位于 `apps/api/migrations/20261103120000_entity_localizations.sql`（#6151）。
下文是设计建议，原型字段名不构成另一份运行时契约；生产执行情况以发布和数据库证据为准。

### 存储

分别建 `skill_localizations` 与 `agent_localizations`，禁止使用无 FK 的多态 entity_id 表。
每表至少包含：org_id、实体 id、locale、source_revision、source_digest、translation_revision、
status、provenance、updated_by、created_at、updated_at 及有类型的可翻译列。

- Skill 列：display_name、summary、duty；Agent 列：display_name、role_label、duty、avatar_alt。
- 内容列 nullable 表示该字段缺译，空白输入须在契约层规范化为 null；不把空串当作有效译文。
- 唯一键 `(org_id, entity_id, locale, source_revision)`；以 `(entity_id, org_id)` 复合 FK
  绑定原实体（真实 SQL 分别使用 skill_id / agent_id）。
- source_revision 由源展示快照生成，覆盖用于展示的发布版本 id、源字段及官方元数据摘要。
  不仅凭 entity id 关联“最新”翻译。源摘要用规范化字段序列计算，算法在一个 helper 中定义。
- translation_revision 是每行的乐观并发计数，更新/删除必须 compare-and-swap。
- 草稿/审核状态、provenance/作者信息必须有约束；不是客户端带 reviewed 即获得发布权。
- 主表新增可空 source_locale；历史未知来源保留 null，不将所有内容猜成中文。
- FORCE RLS、显式 org WHERE、组织冻结、组织删除清理与现有租户表一致。
  权限沿既有身份守卫；本地化不授予实体读取权或执行能力。

`capability_listings` 不再复制维护一份译文。先按既有权限组装源 DTO，再用实体翻译叠加。
平台内容由平台作者维护；租户只能读授权共享内容，不能用本地化接口改平台实体。

### 上线/回退顺序

1. 加表及 nullable 元数据，旧应用仍能工作；迁移不改变已有 name 唯一约束、不更新发布版本。
2. 部署可选 display 字段的读取与显式翻译写入，再接前端；无译文仍返回源内容。
3. 官方内容使用新包版本显式导入，不在 migration/startup 自动写入官方内容。
4. 应用回滚到旧版时翻译表保留，新字段不影响旧客户端；不以 DROP TABLE 作为常规回滚。
5. 数据修复/批量回填须有独立可审阅脚本、来源及 dry-run，不自动覆盖用户原文。

## 二、API 设计

### 展示读取

在现有目录/list/detail/profile 读取增加可选 locale，沿用一期最终确定的 locale 类型；
默认源内容。暂定 zh-CN/en，实施时以一期事实源为准，后端不可 import web 组件。

现有 name/role 等保持源字段语义；新增可选 display 对象：

```json
{
  "sourceRevision": "opaque-server-revision",
  "sourceLocale": "zh-CN",
  "requestedLocale": "en",
  "fields": {
    "name": {"value": "Product discovery", "resolvedLocale": "en", "fallback": false},
    "duty": {"value": "源语言职责", "resolvedLocale": "zh-CN", "fallback": true}
  }
}
```

字段级元数据避免一行部分回退却声称全部英文；未知源语言 resolvedLocale 可为 null。
仅 reviewed 且 sourceRevision 匹配的译文参与普通展示；其余逐字段回退源文本。
编辑管理接口可以回显 stale/draft，但它们不进入成员展示。
缓存必须包含 locale、租户、权限与源/译版本；不得在服务端全局变量保存用户语言。
搜索加入当前 locale 的有效译名/摘要，返回同一实体一次，再分页；不能 JOIN 后分页丢实体。

### 翻译写入（拟议 operation）

- `GET /admin/skills/:skillId/localizations/:locale`，Agent 对应同形路径。
- `PUT /admin/skills/:skillId/localizations/:locale`，Agent 对应同形路径。
- `DELETE /admin/skills/:skillId/localizations/:locale`，Agent 对应同形路径。

PUT 输入：sourceRevision、expectedTranslationRevision（首次为 null）、status、允许字段。
翻译版本由服务器生成，禁止客户端写 orgId、creator、official 来源或任意可执行字段。
DELETE 同样要求 revision；鉴权与既有管理/作者能力一致，不能假设所有成员都能编辑。
首批只向当前已授权编辑该实体的人开放，新增协作者权限另行定义。

失败：未认证 401；已知无权限的管理操作依既有守卫 403；不可见实体 404；
不支持 locale/非法展示字段 422；源版本或译文版本冲突 409。契约错误码集中定义。
不支持的 locale 不静默写入新行；读取协商失败回源语言。

## 三、导入导出

首批 resolver/编辑不改变 v1 包，v1 fixture 的验证与摘要全部保持。
后续另一个 feature 引入明确 v2 包：sourceLocale、源展示元数据与 localizations 纳入包摘要；
执行文件/指令摘要仍只覆盖实际执行内容。新包版本显式导入；不重写旧包/历史摘要。

同幂等键同 payload 重放返回同结果；同键异译文 payload 拒绝；
实体、执行版本、翻译在同一事务写入，任一失败整包回滚。
旧源版本翻译不能冒充新版本，升级发现源摘要不匹配就 stale。
通用实体导出尚未确认存在；新增导出必须保留原始字节及稳定坐标，round-trip 不改变执行摘要。

## 四、实施任务与测试先行

每个任务一个 issue/PR，不把整个三期合成一个 feature。具体测试文件均是拟新增，不声称已运行。

| 顺序 | 实现与责任文件 | 先写的验证 |
|---|---|---|
| A | contracts/entity-localization.ts；domain/localization 源摘要与字段回退 | 新增 contracts 测试：非法 locale/字段拒绝、缺译/空串/混合回退、旧响应仍可解析 |
| B | 时间戳迁移；infrastructure/localization 租户仓储 | 新增 API `tests/localization/entity-localization-pg.test.ts`：真 PG 双租户、冻结、组织删除、重放、并发冲突 |
| C | application/localization 用例；interface/controllers 翻译管理操作 | 新增 `tests/localization/entity-localization-http.test.ts`：作者/管理员/普通成员及平台写入反例，404/409/422 |
| D | agent-directory 与 skill-catalog 读投影、搜索 | 新增 `tests/localization/entity-localization-catalog.test.ts`：源版本升级失效、分页唯一、译名搜索、权限缓存 |
| E | Agent/Skill 页面消费 display，官方包展示元数据替换旧映射 | 新增 web `tests/e2e/entity-localization.spec.ts`：中英切换、自建原文、缺译、键盘操作、头像 alt、输入保存 |
| F | 独立包 v2 builder/import/export | 新增包契约/真 PG 测试：v1 回归、v2 篡改、幂等、回滚、round-trip |

关键反证：用相同版本执行一次后切换 UI locale，再捕获模型请求。
指令原始字节、skill pins、digest、工具授权相同；UI name 可变，模型目录仍来自执行快照。
不能用回环模型硬编码成功替代这一请求捕获断言。

实施后命令（测试先落地，再将这些命令纳入对应 feature verification）：

```bash
pnpm --filter @repo/contracts typecheck
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api exec vitest run tests/localization/entity-localization-pg.test.ts tests/localization/entity-localization-http.test.ts tests/localization/entity-localization-catalog.test.ts
pnpm --filter @repo/api exec vitest run tests/skills/explicit-starter-import.test.ts tests/skill/starter-pack-upgrade.test.ts tests/chat/skill-catalog-matched.test.ts
```

真 PG 基础设施按现有测试配置建立；用例不得因缺 PG 而 skip 后报告通过。
Web 命令在一期/二期测试基线稳定后登记，不虚构现有浏览器 fixture。

## 五、签核差异与启动条件

现有下列文件 frontmatter 实际为 confirmed；正文 pending 注释不是当前权威：
- `phases/phase-20-work-stack-foundation/contracts/agent-role/design-signoff.md`
- `phases/phase-20-work-stack-foundation/contracts/work-skill-meta/design-signoff.md`

它们 covers 的 AG01–AG07 / WS01–WS05 不含新增 localization feature。
不修改旧签核覆盖范围或签核人，拟在正式分配 feature 后新增 delta：
`phases/phase-20-work-stack-foundation/design-deltas/entity-localization/design-signoff.md`。
其 base_bundle 先挂 agent-role；跨 Skill/API 的差异必须列入覆盖与阶段一致性复核，
若无可复用不变量则另切正式束。取号前不伪造 covers 或创建空签核文件。

交由人类审阅的精确内容：
1. UI：编辑器源语言/译文分栏、源内容只读对照、缺译与过期提示、源语言保存/删除译文语义。
2. 用例：字段级回退、作者权限边界、源更新失效、译文乐观锁与平台内容只读。
3. API：本文件第二节的 display 形状、三项管理 operation、错误语义；最终 Zod 单源随后落 contracts。
4. 一致性：一期 locale 取值与协商方式、二期 display 消费策略、现有冻结执行版本不被修改。

机械读取点：`.harness/scripts/lib/design-signoff.ts` 的 readDeltaSignoffs / auditSignoff /
assertDesignSignedOff；delta 需真实 base_bundle 已确认，covers 绑定真实 feature，
并由阶段 design-coherence.md 复核。当前没有本地化 feature claim，因此不声称已跑出该门的失败。

本次“直接开发”授权已记录，毋需再问是否继续；三期真正开始接入前核实前两期验收证据，
如需仓库形式签核，只提交上述具体差异供签，不将一般开发授权伪写成 confirmed。
