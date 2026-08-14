# Skill 记录新增 `tags?: string[]` —— contract delta

Status: proposed; human/coord-main signoff required（ADR-023：新增契约字段 = 新增设计面，
不满足「零新增设计面」的免签核条件，即使字段可选、范围小——不能像 F158/F164 那类纯前端
重排那样直接免签）。

覆盖：本轮 `/skill` 后台修复（人类 8 项截图报告里的 G5），不新建 feature id，
随 G1/G2/G3/G4/G6/G7 同一个 PR 交付（这些其余六项均不涉及契约变更，见 PR 描述）。

派工依据：coord-main 2026-08-14 会话内确认整体方案后，补充治理要求——G5 需要一份
design-delta 记录（不必走完整契约束流程），照 #953 / token-quota-and-usage 先例，
实现与补签并行、PR 等 coord-main 代人类核对。

---

## 0. 背景（人类原话，逐字）

「skills的浏览界面，应该要有tags的过滤，新建的时候要支持添加tags，card需要可以编辑」。

实测（SHA 见本 delta 所在 PR 的基线）：`packages/contracts/src/skills.ts` 的
`SkillListItem` 与 `createSkillDraft.in` **都没有 `tags` 字段**——2026-08-13 那一轮
（`skill-catalog-live.tsx` 头注「tag 过滤 chip」）已经复核过一次同一件事：当时的结论是
「用已有的三个封闭枚举（来源/状态/可见范围）顶替『标签』语义，不新开契约面」。
这一轮人类原话更明确地区分了两件事——「浏览按 tags 过滤」与「新建时添加 tags」——
后者没有任何既有字段能顶替：`DeclarativeContract` 六个字段里没有一个是自由标签。

## 1. 字段

```ts
// SkillListItem（packages/contracts/src/skills.ts）
tags: z.array(z.string()).default([])   // 新增，位于末尾，不影响既有字段顺序
```

```ts
// createSkillDraft.in（同文件）
tags: z.array(z.string()).optional()    // 新增，可选
```

两处都是**加字段**，不改、不删任何既有字段；两个 schema 仍是 `.strict()`
（`.strict()` 只拒绝契约里没声明的 key，不影响「新声明的 key 是不是必填」）。

## 2. 为什么加、加在哪

- **为什么加**：人类直接要求 Skill 新建/编辑时能打标签，浏览页要能按标签过滤——
  这是本轮 8 项里唯一一条「界面上要看得见一个后端今天完全没有的概念」的诉求，
  三个既有封闭枚举（来源/状态/可见范围）语义上都不是「使用者自由打的标签」，
  顶替不了。
- **加在 `SkillListItem`**：卡片展示与浏览过滤都读列表项，字段落这里最直接，
  与 `satisfaction`/`currentVersionId` 这类既有的「列表项自带」字段同一层级。
- **加在 `createSkillDraft.in`**：G3 的「新建 Skill」弹窗（完全新建 · 契约表单这条
  路径）需要一个入参把使用者填的 tags 带到后端。
- **不加在 `skills`（wave2/模型 A）表**：URL 导入 / starter-pack 导入没有表单，
  这条路径的「新建」不产生 tags；`pg-skill-contract-repository.ts` 的 `listAll()`
  合并读时给这批行 `tags: []`（应用代码里的映射默认值，不是 DB 默认值）。
  只有声明式契约创建路径（`skill_contracts` 表，模型 B）落真实 `tags` 列——
  见迁移 `20260814090000_g5_skill_contract_tags.sql` 的头注。

## 3. 向后兼容性 —— 逐条保证

1. **两个字段都不是必填**：`SkillListItem.tags` 用 `.default([])`（旧数据/旧调用方
   构造的对象不带 `tags` key 时，`.parse()` 自动补 `[]`，不报错、不需要每个构造点
   都改代码）；`createSkillDraft.in.tags` 用 `.optional()`（旧前端/脚本不传这个字段
   时请求体照常通过校验，服务端按「没打标签」处理）。
2. **DB 列有默认值**：`ALTER TABLE skill_contracts ADD COLUMN tags text[] NOT NULL
   DEFAULT '{}'`——迁移当时已存在的每一行自动补 `{}`，不需要额外的 backfill 脚本，
   不会有任何一行落在「列存在但是 NULL」这个需要额外判空的状态。
3. **不影响任何既有读写路径**：不修改 `.strict()` 之外的任何既有 key；`SkillContractRow`
   / `GuardedSkillContract` 等中间类型新增 `tags: readonly string[]`（非 optional，
   因为它们是**已解析后**的内部形状，由仓储层保证永远给得出，不是契约边界）。
4. **前端渲染**：`SkillCatalogLive` 卡片新增的 tags 展示只在 `row.tags.length > 0`
   时渲染一行 chip；空数组时不多占位、不报错——与既有 `satisfaction === null` 显示
   「样本不足」的空态纪律一致（不同的是 tags 空就是真的什么都不显示，不是一句提示语，
   因为「没打标签」不是一个需要向使用者解释的异常状态）。

## 4. 本轮**不做**的扩展（如实登记，不是偷工减料）

- 浏览页的 tag 过滤（G4 既有的 `TagFilterBar`）本轮**不扩展**到按自由 tags 过滤——
  过滤维度仍是既有三组封闭枚举。理由：真实 tags 数据这一轮才开始产生，样本几乎为
  空时做"按 tag 过滤"没有验收意义，且过滤逻辑要处理"多值/大小写/去重"这类边界，
  仓促做容易在过滤上引入 bug。已记录为独立 issue（见 PR 描述），tags 先"存得进、
  看得见、编辑得了"，过滤维度扩展留到有真实数据之后再做。
- `skills`（wave2）表不新增 `tags` 列——见 §2 最后一条。

## 5. 请人类 / coord-main 在签核时确认

- [ ] §2「只有声明式契约创建路径落真实 tags，wave2 恒 `[]`」是否接受？
      还是要求 URL 导入等路径也能后补 tags（那需要另一个写入口，不在本 delta 范围）。
- [ ] §4「本轮不扩展 tag 过滤维度」是否接受？
