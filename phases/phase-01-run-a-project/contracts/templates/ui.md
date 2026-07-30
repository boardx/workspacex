# 契约束 `templates` — 签核① UI：人看到的界面对不对

> **自检（可机械核对）：本文件引用 41 张截图，目录下实际 41 张。**
> 目录 = `phases/phase-01-run-a-project/ui-preview/tpl-v2/`（`ls *.png | wc -l` 应得 `41`）。
> 二者相等，且第二节逐张列出、无遗漏无重复（`lint-ui-material.mjs` 做双向集合相等）。
>
> ⚠ **2026-07-30 重做**：截图目录已从 `tpl/`（v1，24 张）换成 **`tpl-v2/`（41 张）**。
> v1 被保真度审计判「重做」——它把蓝本设计器的 **16 个配置面板** 只渲染了 1 个（基本配置），
> 其余 15 个标「未探明」占位，并把「基本配置」误当分组标题，16 项数成 15，污染了完成度分母。
> 逐条对照原型偏移见同目录 [`V1-WAS-WRONG.md`](../../ui-preview/tpl-v2/V1-WAS-WRONG.md)。
> v1 的 `tpl/`（24 张）**保留不动**（推翻要留痕），但 `ui-material-map.json` 已把本束指向 `tpl-v2/`。
>
> ⚠ **目录名是 `tpl-v2/`，不是 `templates/`**。束名叫 `templates`，截图目录叫 `tpl-v2`（跟随能力域代号 + 重做版号）。

## 本文现在是什么状态

**41 张真图（真实组件 + mock，0 条控制台报错），第 ① 件具备「可看」的条件。**
最大的变化：**蓝本设计器的 16 个配置面板全部落成真实界面**（v1 只有 1 个）。
路由仍是预览面 `/tpl`（`?screen=` 切屏、`?as=` 切视角、`?state=` 切七态；面板切换是屏内点选）。
第一节各屏「现状」列写 **未建** 说的是**产品路由**（`/admin/blueprint` 等）尚不存在，不是原型没画。

---

## 一、16 个配置面板 —— 本次重做的核心（UC-2.1 设计器）

左栏「设计配置 16 / 16」是原型自报数（原文「设计环节 16/16」，D-03 正名为「设计配置」）。
下面 16 行 = 原型 16 个面板 flag（`isBpBasic`…`isBpRep`，偏移 16529477–16627026）逐一落地，
**每个面板一张内容截图**，内容全部逐字来自原型（非占位）。

| # | 面板 | 截图 | 屏上有什么（原型内容） | 服务 feature |
|---|---|---|---|---|
| 01 | 基本配置 | `ui-preview/tpl-v2/uc-2-1-panel-01-基本配置.png` | 总览面板：时长档位四档（半天/一天/两天默认/三天，含半场与环节数）＋『可选环节自动增删，必留环节只压缩时间』规则句 ＋ 形式三选 ＋ 语言 ＋ 模型策略三 lane（机密硬路由）＋ 配额 3.5M/90% 不硬停 ＋ 套用后初始化六类 | F17 F18 F19 F20 F21 |
| 02 | 主题与背景 | `ui-preview/tpl-v2/uc-2-1-panel-02-主题与背景.png` | 主题句式（含时间约束/可证伪/≤30字/不写方案四规则）＋ 背景要素 5 项（各带来源）＋ 生成与校验四条 | F18 |
| 03 | 流程 Agenda | `ui-preview/tpl-v2/uc-2-1-panel-03-流程Agenda.png` | 半天档 7 环节列表（拖动握把 · 可选/必留标 · 时长 · 绑画布Skill）＋ 编排动作 ＋ AI 节奏核对建议（超时 22 分钟证据） | F18 |
| 04 | 分组规则 | `ui-preview/tpl-v2/uc-2-1-panel-04-分组规则.png` | 按人数落组数三档 ＋ 场景清单 4 组（每组问题＋组长画像，最值钱的部分）＋ 组长与成员分配 5 条 | F18 |
| 05 | 角色与权限 | `ui-preview/tpl-v2/uc-2-1-panel-05-角色与权限.png` | 分组方式（职能混编/按议题自选）＋ 角色权限矩阵 5 能力 × 4 角色（引导/组长/组员/观察者，✓ 与灰色🔒硬约束双通道）＋ 邀请与进场三类 | F18 |
| 06 | 问卷 | `ui-preview/tpl-v2/uc-2-1-panel-06-问卷.png` | 会前预习问卷（开始前5天·60%阻断·8题骨架）＋ 会后满意度问卷（进 Skill 改进队列） | F24 F25 |
| 07 | 访谈与对象 | `ui-preview/tpl-v2/uc-2-1-panel-07-访谈与对象.png` | 预设访谈计划 6 场按角色配额 ＋ 授权硬约束（未确认前『开始访谈』禁用）＋ 证据规则三条（2 独立来源/附和不算/虚拟不计强度） | F24 |
| 08 | 会前任务 | `ui-preview/tpl-v2/uc-2-1-panel-08-会前任务.png` | 3 项任务，每项挂环节 ＋『不做会怎样』红字后果 ＋ 截止 ＋ AI 催办规则 | F24 F25 |
| 09 | 场地与形式 | `ui-preview/tpl-v2/uc-2-1-panel-09-场地与形式.png` | 空间要求清单 5 ＋ 形式差异三态（混合默认/全线上跳过打印/纯线下×1.2）＋ 现场布置图 4 组 | F19 |
| 10 | 项目材料 | `ui-preview/tpl-v2/uc-2-1-panel-10-项目材料.png` | 物料清单 9 件表（数量/用于环节/谁准备），按 4 组 16 人换算 ＋ 导出清单 | F24 F25 |
| 11 | 分组打印素材 | `ui-preview/tpl-v2/uc-2-1-panel-11-分组打印素材.png` | 4 件打印件 A0/A3/A5/A4（版面同构、AI生成洞察卡）＋ 二维码 OCR 便签级回流『保留原位可点回原图』 | F24 F25 |
| 12 | 组内能力 | `ui-preview/tpl-v2/uc-2-1-panel-12-组内能力.png` | 7 项能力默认开/关 ＋ 产出回流三条去向 ＋ 可见性矩阵（组员/引导师/观察者 看得到 vs 看不到） | F26 F27 |
| 13 | Agent 编排 | `ui-preview/tpl-v2/uc-2-1-panel-13-Agent编排.png` | 在场 agent 4（同环节最多两个可主动发言）＋ 介入尺度（阈值 5 次·9 位主持人反馈史）＋ 4 条硬约束（AI 不写决策等） | F26 F27 |
| 14 | Skill 绑定 | `ui-preview/tpl-v2/uc-2-1-panel-14-Skill绑定.png` | 11 条 Skill 绑在环节上；『亲和图自动聚类 v2』满意度 62% 已降级、红旗『发布前必须替换』——**界面真正演示的发布门槛** | F20 F26 |
| 15 | 输出物 | `ui-preview/tpl-v2/uc-2-1-panel-15-输出物.png` | 6 件产出（生成方式＋去向，2 件必须红点）＋ 回流规则『只能绑固定快照』＋ 结项检查四条 | F29 |
| 16 | 报告模板 | `ui-preview/tpl-v2/uc-2-1-panel-16-报告模板.png` | 客户交付版 18 页骨架（每章标『必须人写/AI 起草』）＋ 内部复盘版 6 页 ＋ 写作硬约束 ＋ AI 起草 22 分钟历史 | F22 F29 |

> ⚠ 面板计数徽标（如「7 环节」「4 组」「11 个」）与完成度分母 `n/16` **同屏两个含义不同的数字，不得串位**。
> 分母恒读表（`configTotal()`），禁止硬编码 16/15——v1 正是硬编码成 15 才出的错。

## 二、蓝本设计器七态 + 发布确认（UC-2.1）

| 截图 | 态 | 屏上有什么 | 服务 feature |
|---|---|---|---|
| `ui-preview/tpl-v2/uc-2-1-designer-default.png` | default | 落地屏 = 第 1 个面板『基本配置』总览，左栏 16 面板目录『设计配置 16/16』＋ 版本条 v4·用过12次 ＋ 三动作［预览参与者视图］［试跑一场］［发布 v5］ | F17-F21 |
| `ui-preview/tpl-v2/uc-2-1-designer-loading.png` | loading | 设计器骨架加载态 | F18 |
| `ui-preview/tpl-v2/uc-2-1-designer-empty.png` | empty | 新建蓝本空态（完成度 0/16） | F17 F18 |
| `ui-preview/tpl-v2/uc-2-1-designer-invalid.png` | invalid | 发布门槛校验失败：降级 Skill 未替换（原型明写的那道门） | F20 F22 |
| `ui-preview/tpl-v2/uc-2-1-designer-dep-failed.png` | dep-failed | 依赖失败：20-model 模型清单不可用，基本配置模型策略无可选模型 | F20 |
| `ui-preview/tpl-v2/uc-2-1-designer-denied.png` | denied | 无权限：观察者不可编辑、看不到未发布草稿 | F17 |
| `ui-preview/tpl-v2/uc-2-1-designer-success.png` | success | 成功态：已发布 v5，旧版 v4 归档 | F22 |
| `ui-preview/tpl-v2/uc-2-1-designer-publish-confirm.png` | 确认框 | 发布二次确认：复述『原型明写的门槛』——降级 Skill 阻断，按钮显示『有阻断项·无法发布』。危险动作走统一 ConfirmDialog（S-14） | F22 |

## 三、其余屏（UC-2.2 / 2.3 / 2.4，沿用 v1 信息架构，重截入 tpl-v2）

| 截图 | 态 / 视角 | 屏上有什么 | 服务 feature |
|---|---|---|---|
| `ui-preview/tpl-v2/uc-2-4-list-default.png` | default | 后台『项目蓝本』列表：7 行元数据（N 环节·时长·用过·满意度·n/16 已配）＋ 行操作 ＋ 页头统计 ＋ 新建三入口 | F30 F22 |
| `ui-preview/tpl-v2/uc-2-4-list-denied.png` | denied | 可见性限制下的无权限态 | F30 |
| `ui-preview/tpl-v2/uc-2-4-list-archive-confirm.png` | 确认框 | 归档二次确认（引用计数 >0 ⇒ 只能归档，O-18①），含影响范围 | F30 |
| `ui-preview/tpl-v2/uc-2-4-list-delete-confirm.png` | 确认框 | 删除二次确认（引用计数 =0 那一支）——补齐 v1 只画了归档一支的缺口 G-4 | F30 |
| `ui-preview/tpl-v2/uc-2-4-versions-default.png` | default | 版本历史 v1–v4 ＋ 版本间差异 ＋ 锁定徽标 ＋ 回滚入口 | F30 |
| `ui-preview/tpl-v2/uc-2-4-versions-invalid.png` | invalid | 回滚到『进行中项目在用』的版本被拒，并列出占用它的项目（ROLLBACK_TARGET_IN_USE） | F30 |
| `ui-preview/tpl-v2/uc-2-4-versions-rollback-confirm.png` | 确认框 | 回滚二次确认：语义是『新建等同旧版的新版本』而非拨指针（O-18②） | F30 |
| `ui-preview/tpl-v2/uc-2-2-apply-default.png` | default·步1 | 新建项目向导 · 选蓝本，底部『项目侧缺失概念』警示框（议程环节字段名四方打架） | F23 |
| `ui-preview/tpl-v2/uc-2-2-apply-step2.png` | 步2 | 向导第 2 步：选档位 ＋ 预览套用后初始化六类 | F21 F23 |
| `ui-preview/tpl-v2/uc-2-2-apply-dep-failed.png` | dep-failed | 快照内核不可用 ⇒ 拦住建项目，避免无版本引用的项目 | F23 |
| `ui-preview/tpl-v2/uc-2-2-prep-default.png` | default | 项目筹备页：四子标签（自带计数）＋ 定题单点继承 ＋ 分组编排 ＋ 组卡内观察/访谈对象表 | F24 F25 |
| `ui-preview/tpl-v2/uc-2-2-prep-invalid.png` | invalid | 校验失败：主题超长 ＋ 有组无组长 ⇒ 无法保存并同步 | F24 |
| `ui-preview/tpl-v2/uc-2-2-prep-member.png` | default·member | 组员视角投影：写操作按钮置灰（?as= 权限态，V14） | F24 F25 |
| `ui-preview/tpl-v2/uc-2-2-workflow-default.png` | default | 工作流编排：模板层（已套用·来自后台 v2）＋ 议程环节 × 三角色矩阵 ＋ 模板库三行 | F26 F27 |
| `ui-preview/tpl-v2/uc-2-2-workflow-switch-confirm.png` | 确认框 | 换工作流模板二次确认（破坏性 ＋ 影响范围 ＋ D-11 未定旗标） | F26 |
| `ui-preview/tpl-v2/uc-2-3-promote-default.png` | default | 提回蓝本：左偏离清单（原值→本场值＋必填理由）＋ 右待审改动收件面（含并排态）。屏顶自带旗标『两侧屏一未探明一确认缺失』 | F29 |
| `ui-preview/tpl-v2/uc-2-3-promote-empty.png` | empty | 真实空态：本场照蓝本跑、无偏离（NO_DEVIATIONS 不强凑） | F29 |

**合计 8（面板七态+确认）＋ 16（面板内容）＋ 17（其余屏）= 41 张，与目录下 `*.png` 实际数量相等。**

---

## 四、第 ① 件材料缺口（仍需带着看）

- **G-A**（原 G-5，**已消解**）：v1 把 15 个面板标「未探明」是错的——它们在原型里全是成品，本版已画。
  仍未画的是**各面板内某个条目再点开的二级编辑器**（如议程环节点开后的单环节编辑弹层），
  那属更深一层；本版面板已到「原型面板本身」这一层，与原型齐平。
- **G-1**（沿用）：矩阵格 → 待办的跨屏联动（F27）仍未演示 round-trip，`[看任务]` 只弹 toast；粒度前提卡 D-10。
- **G-2**（沿用）：项目卡蓝本徽标建议补 `projects-card-<id>-blueprint`（在 `/projects`，不在本预览面）。
- **G-3**（沿用但缩小）：换**时长档位**的增删动画与撤销仍未演示——但『可选自动增删/必留压缩时间』
  这句**原型逐字写着**（偏移 16530146），v1 误报成「待裁 D-8」，本版已作为**确认内容**渲染在基本配置面板，
  不再挂「与原型冲突」旗标。见 V1-WAS-WRONG 错误 3。
- **G-7 / G-8**（沿用）：提回蓝本两侧屏一个未探明（复盘归属未定）、一个确认缺失（收件面入口待定），整份 UC-2.3 不可 sign-off。
- **G-10**（沿用）：移动档（375/768）截图未抓，仅跑溢出探针。

## 五、七态豁免（D-36）与非豁免业务态

七态按 `uiux-standards.md` 统一实现、sign-off 豁免逐屏设计。本束**非豁免**的业务态：
- **发布门槛**（原型明写）：绑定 Skill 有『组织层已降级未替换』⇒ 阻断发布（见 panel-14 与 publish-confirm）。
  另有一份『必填项完成才能发布』的清单**未定（缺 D-2）**，当前 16/16 全配，无未完成必填项，不作为主门槛。
- **蓝本行操作二分**：删除（引用=0）vs 归档（引用>0），由服务端派生（list 两张确认框各演示一支）。
- **降级可见态**：配额达 90% 对话流降级提示，不硬停。
- **待审改动三态 / 同一处多场改动并排态**（promote 屏）。
