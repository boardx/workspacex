# `project` 束 · 「项目」首页卡片网格 + 标签过滤 —— UI 先行原型（改版提案）

> **性质**：ADR-003 / ADR-023 第 ① 件（UI）签核材料的**候选**。人类截图 / 口头反馈现有纯列表
> 首页（生产屏 `apps/web/components/projects/projects-screen.tsx`）不满意，要求改成**卡片网格 + 标签过滤**。
> 这是先出原型给人签核、再决定是否接线的那一步，**尚未接线、未改生产屏**。
>
> ⚠ **本目录未登记进 `ui-material-map.json`**（`project` 束仍映射 `ui-preview/project-v2/`）。
> 所以它**不进** `lint-ui-material` 的双向门控，也**不改** `ui.md` / `design-signoff.md` 的任何
> `status`——那是人类的动作（ADR-023）。人类采纳后，再由人决定是否把它并入 project-v2 / 重签。
> （旧目录 `ui-preview/project/`（v1, 19 张）同样是未登记的留痕目录，本目录沿用同一摆放惯例。）

## 一、可跑的原型

- 路由：`/preview/projects-card-grid`（`apps/web/app/preview/projects-card-grid/page.tsx`）
- 组件：`apps/web/components/preview/projects-card-grid-screen.tsx`（真实组件 `Card`/`Badge`/`Button` + `StateShell`）
- mock 数据：`apps/web/lib/mock/projects-cardgrid.ts`（14 条，接近真实一屏密度）
- 抓图脚本：`apps/web/scripts/shot-projects-cardgrid.mjs`（视口 1360×1000、deviceScaleFactor 2、fullPage）
- 七态切换：URL `?state=default|loading|empty|invalid|dep-failed|denied|success`（生产构建不可达）

## 二、10 张截图对应哪个 UC 的哪一节

对应 UC-0.2「项目列表页（增删改查主入口）」的**呈现形态**，是既有 project-v2 里
`uc-00-2-allprojects-*` 那一屏的**布局重排**（列表 → 卡片网格 + 多维筛选），不是新用例。

| 截图 | 覆盖 | 说明 |
|---|---|---|
| `projects-cardgrid-default.png` | 默认态 | 3 列卡片网格 + 三组筛选维度 |
| `projects-cardgrid-loading.png` | 加载态 | StateShell 骨架屏 |
| `projects-cardgrid-empty.png` | 空态 | 组织无项目引导 |
| `projects-cardgrid-invalid.png` | 校验失败态 | 新建重名/空名校验（`err-name`） |
| `projects-cardgrid-dep-failed.png` | 依赖失败态 | 项目服务不可用，写操作置灰 |
| `projects-cardgrid-denied.png` | 无权限态 | 组织层限制（组织已停用） |
| `projects-cardgrid-success.png` | 成功态 | 归档成功回执 |
| `projects-cardgrid-tag-filtered.png` | 交互 | 选中「客户共创」标签 → 命中子集 + 命中计数 |
| `projects-cardgrid-filter-empty.png` | 交互 | 三维交集为空 → 空结果引导（区别于「组织无项目」空态） |
| `projects-cardgrid-archive-confirm.png` | 危险动作 | ⋯ 菜单 → 归档二次确认 + 影响范围说明（非孤零零红按钮） |

## 三、我替 UC 做了哪些它没写明的设计决定（人类请逐条看）

1. **三维筛选而非单一「标签过滤」**。人类只说「标签过滤」，但生产契约 `ProjectListItem`
   根本没有 tags 字段。我把筛选拆成三档、并在 UI 上**明确标出每档的契约出处**：
   - ① 项目类型 `kind` —— 契约 `ProjectKind`，**有出处，可直接接真**
   - ② 状态 `status` —— 契约 `ProjectStatus`，**有出处，可直接接真**
   - ③ 标签 `tags` —— **探索性 mock，无契约出处**，UI 上打了「探索性 · 无契约出处 · 待人类 + API 契约裁决」标记，标签徽标用**虚线边框**与有出处的实心/描边徽标区分。
   这样人类能一眼分清「哪些是现在就能上的筛选，哪些要先补契约」。
2. **探索性标签词表刻意避开被否掉的编字段**。生产屏文件头点名 owner / priority /
   readiness / stageProgress / schedule「没有出处、故意不补」。我没有借标签之名把它们复活——
   标签取的是「客户共创 / 内部演练 / 本季重点 / 跨团队 / 已交付 / 待复盘」这类**协作场景标签**，
   且全部标注为待裁决，不假装它们已经存在于契约里。
3. **网格断点** 1/2/3 列（`grid-cols-1 sm:2 lg:3`），沿用 #1158 tpl 卡片网格同一断点比例尺，
   保持两个卡片网格屏视觉一致。UC 未规定列数。
4. **同组多选取并集、跨组取交集**，空选 = 不过滤。UC 未规定多选语义，我选了信息检索里最常见、
   与 #1158 tpl 标签过滤一致的语义。
5. **危险动作（归档）沿用生产屏 `ProjectRealCard` 的语义**：⋯ 菜单 → 二次确认 + 影响范围三条
   （只读 / 不删除可恢复 / 快照仍可引用），不做成孤立红按钮。删除仍然**不提供**（Q-9：归档承接退役）。
6. **原型级动作只回一句提示**（进入 / 新建 / 归档点击后弹 `projects-cardgrid-action-note`），
   诚实表明「真实动作在生产屏接后端，本屏不改数据 / 不跳转」，不做点了假装成功的死控件。

## 四、R8 线索之间的矛盾与处理

- **「标签过滤」 vs 「宁可少画不编字段」**：人类想要标签过滤，但契约没有 tags。
  两条硬约束直接冲突。处理：**不二选一**——把标签做出来给人看效果（满足呈现诉求），
  同时**在界面和数据源两处都显式标注 tags 无契约出处、待裁决**（满足不编字段的纪律）。
  最终是否采纳，交给人类 + API 契约（第 ③ 件）一起裁；若采纳需新增 tags 面、走 delta 重签。

## 五、与现有生产实现的字段完整度差异（签核用，不是我在编字段）

| 维度 | 生产屏 `projects-screen.tsx`（接真） | 本原型 |
|---|---|---|
| 数据来源 | 真实 `GET /projects`（`ProjectListItem` 五字段） | 纯 mock，字段=契约五字段 + 一个探索性 `tags` |
| 布局 | 纯列表，分「我在里面 / 我管着它」两段 | 卡片网格，不分段（分段语义可叠加，见待确认清单） |
| 筛选 | 仅按项目名文本搜索 | kind（契约）+ status（契约）+ tags（探索性）三维 |
| tags | **无此字段** | 有，但**显式标注无契约出处、待裁决** |
| owner/priority/readiness 等 | 无（契约无出处，故意不补） | **同样一个都没画**（不借标签复活） |

## 六、待确认清单（第 ① 件签核时人类逐条裁）

- [ ] **A. 采不采纳卡片网格**替换现有纯列表？（呈现形态本身）
- [ ] **B. tags 探索性字段要不要落契约**？采纳 = API 契约（第 ③ 件）新增 tags 面 + delta 重签；
      不采纳 = 只保留 kind/status 两维筛选，删掉标签组。**这一条必须人类 + API 契约一起裁，agent 不能自决。**
- [ ] **C. 卡片网格是否保留「我在里面 / 我管着它」的分段**？本原型为看密度先不分段；
      生产 `listProjects` 返回 member/managed 两段，接线时可选「分段网格」或「合并网格 + 归属徽标」。

## 七、建议签核时重点核对的 3 处

1. **标签组的探索性标记是否足够醒目**（`projects-cardgrid-default.png` 筛选区第三行 + 卡片虚线标签）——
   这是全屏唯一「无契约出处」的部分，必须让人类一眼看出它和 kind/status 不是一个可信度等级。
2. **归档二次确认的影响范围文案**（`projects-cardgrid-archive-confirm.png`）是否与生产屏一致、无夸大。
3. **信息密度**：14 条卡片在 3 列下的真实观感（`projects-cardgrid-default.png`）——
   卡片比列表行占纵向空间更大，一屏能看到的项目数变少，请确认这个取舍可接受。
