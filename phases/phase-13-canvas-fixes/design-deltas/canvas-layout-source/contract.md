# contract · canvas-layout-source

单一事实源：本文件描述 `F1681` 要改的契约形状。issue：
https://github.com/boardx/workspacex/issues/2221

## 1. DB：`canvas_templates` 新增列

```sql
ALTER TABLE canvas_templates
  ADD COLUMN layout_source text NOT NULL DEFAULT 'builtin-derived'
    CHECK (layout_source IN ('builtin-derived', 'user-edited'));
```

- 幂等迁移（`IF NOT EXISTS` 风格 / 可安全重跑，同本仓既有迁移纪律）。
- 迁移时**不回填**存量行的真实来源判断——统一落 `DEFAULT`（见 design-signoff.md
  确认点④）。这一列只对**之后**发生的写入生效。

## 2. 契约：`packages/contracts/src/canvas.ts`

`layoutSource: z.enum(["builtin-derived", "user-edited"])` 加进模板行输出 schema，
与既有 `builtin: z.boolean()` 相邻声明（两者语义不同，都保留——`builtin` 说的是
「这个 key 在不在 19 个内置清单里」，`layoutSource` 说的是「这一行的几何是不是
人改过」，合并会重现 `builtin` 字段头注释里点过名的那类混淆）：

- `listTemplates.out.templates[]`
- `createTemplate.out`（新建即 `builtin-derived`，创建路径不接受这一栏，服务端写死）
- `updateTemplateDraft.out`（草稿改分区/几何 ⇒ `user-edited`，同样服务端写死不接受入参）
- `mintTemplateVersion.out`
- `publishTemplate.out`

`updateTemplateMetadata`（改名/标签/标题/页脚）**不动** `layoutSource`——同它已经
不碰 `sections` 的既有边界一致，元数据改动不算「自定义了几何」。

## 3. 应用层判定（单点）

判定放 `apps/api/src/application/canvas/mint-template-version.ts`（草稿→铸版本的
唯一写路径）：

```
若本次铸版本改动了 sections 中任一影响几何/呈现的字段（layout/tone/cols/max/overflow，
不含纯元数据字段）且触发方是真实编辑器写路径（非 backfill 脚本的显式声明）
  → layout_source = 'user-edited'
否则若该 key 此前已是 'user-edited'
  → 保持 'user-edited'（不可退回，见①）
否则
  → layout_source = 'builtin-derived'
```

`backfill-canvas-builtin-templates.ts` 调用 `createTemplate`/`mintTemplateVersion`
时显式传一个内部标记（如 `source: "backfill"`，**不进契约 `in`**，只在应用层内部
调用签名里，避免被外部 HTTP 调用方伪造），使其永远写 `builtin-derived`。

## 4. `apps/web/lib/canvas/fence-template-resolver.ts`

```
ensureCanvasFenceTemplate(key, orgId):
  若 orgId 存在：
    rows = loadOrgTemplates(orgId)   // 复用既有 30s 缓存，不新增请求形状
    matches = rows.filter(key 匹配)
    若 matches 非空：
      row = 最高版本
      若 row.layoutSource === 'user-edited':
        buildAutoTemplateSpec(row) 注册 → 出口②（组织自定义）
  // 走到这里：orgId 不存在 / 查询失败 / 没有该 key 的行 / 行是 builtin-derived
  若 getTemplate(key) 命中内置注册表 → 出口①（内置原生几何兜底）
  否则 → 出口③（not-found，诚实错误态，逻辑不变）
```

`AUTO_OWNER` / 30s TTL 缓存机制不变；查询失败（catch 分支）与今天一样落 `fetch-failed`
路径，但**新增**一条：`fetch-failed` 且 key 命中内置注册表时，不再直接返回失败，
改为回退出口①（今天的实现在 `orgId` 不存在时才有这条兜底，本次把「查询失败」也
纳入同一条兜底，因为对内置 key 来说「查不到自定义」和「没有自定义」在渲染结果上
应该等价）。

## 5. 错误码 / 边界

不新增错误码。`ResolveTemplateOutcome` 的 `reason` 集合不变（`no-org` /
`not-found` / `fetch-failed`）——`fetch-failed` 语义收窄为「非内置 key 才会真的
失败」，内置 key 永远有兜底出口。
