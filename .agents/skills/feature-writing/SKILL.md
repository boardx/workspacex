---
name: feature-writing
description: >
  激活条件：用户提到写 feature、feature_list、定义功能、feature 粒度、
  user_visible_behavior、verification 命令、功能拆分 等关键词时触发。
  提供 feature 定义的黄金标准和常见反模式。
---

# Feature Writing Skill

## 能力清单（这个 skill 让你具体能做什么）

- 用「4-8 小时人工等效」这把尺，判断一条候选 feature 该拆还是该合。
- 按「垂直切片」而非「技术层横切」的方式划定 feature 边界，确保每个 feature
  都交付一次用户可见的完整价值（见下方领域知识①）。
- 用出口类型分级表（HTTP > 行为输出 > 文件内容 > 存在检查）挑 verification 的
  优先级，拒绝「无断言检查」类命令进清单。
- 识别 6 种常见反模式（表见下），在写 feature 或 review 他人 feature 时对照检查。
- 用「共享文件热点」标注 notes，供 sprint-planner 判断哪些 feature 必须串行。
- 判断一条 feature 是否该配「flag 分类」标签（release/experiment/ops/permission/
  kill-switch，见下方领域知识②）辅助风险与并行判断。

---

## Feature 的黄金粒度

**一个 feature = 一次 agent 会话能完成并验证的工作单元**

太大 → 会话超时，中途无法交接  
太小 → 交接成本高于开发成本

经验值：4-8 小时人工等效工作量。

---

## user_visible_behavior 写法

**公式**：`[用户/系统] [做了什么操作] 时，[产生什么可观察的结果]`

✅ 好的写法：
```
"GET /api/health 返回 HTTP 200 且 body 为 {\"ok\": true}"
"pnpm harness verify --sprint 01/01 执行完毕，F01 状态变为 passing"
"用户在浏览器访问 localhost:3000，页面标题显示 'Orchestrator Dashboard'"
```

❌ 差的写法：
```
"实现健康检查"          # 太模糊，无法验证
"完成 memory 模块"      # 不描述用户可见行为
"代码写完并通过审查"    # 审查不是端到端行为
```

---

## verification 命令写法

**每条命令 = 一个 shell 断言，exit 0 = 通过**

### 层级选择（优先高层）

| 优先级 | 类型 | 示例 |
|--------|------|------|
| ⭐⭐⭐ | HTTP 断言 | `curl -sf localhost:3000/health \| jq -e '.ok==true'` |
| ⭐⭐⭐ | 行为输出断言 | `tsx src/main.ts --task-id T01 \| grep "status=done"` |
| ⭐⭐ | 文件内容断言 | `jq -e '.features[0].status=="passing"' feature_list.json` |
| ⭐ | 文件存在检查 | `test -f package.json` |
| ❌ | 无断言检查 | `pnpm build`（成功≠行为正确） |

### 常用断言模板

```bash
# HTTP 状态 + 响应体
curl -sf http://localhost:3000/api/health | jq -e '.ok == true'

# 命令输出包含关键字
tsx apps/orchestrator/src/main.ts --goal "test" 2>&1 | grep -q "status=done"

# JSON 字段验证
node -e "const p=require('./package.json'); if(!p.scripts.harness) process.exit(1)"

# 文件存在 + 可执行
test -f AGENTS.md && test -x init.sh

# 数值比较
[ $(jq '[.features[] | select(.status=="passing")] | length' feature_list.json) -gt 0 ]
```

---

## feature_list.json 结构

```json
{
  "id": "F04",
  "priority": 4,
  "area": "orchestrator",
  "title": "简短动词短语（<50字）",
  "spec_ref": "<requirements 下文件名>.md#R<n>",
  "user_visible_behavior": "完整的可观察行为描述（1-3句）",
  "status": "not_started",
  "sprint": null,
  "verification": [
    "从用户角度断言的 shell 命令 1",
    "从用户角度断言的 shell 命令 2"
  ],
  "evidence": "",
  "notes": "补充说明、依赖关系、注意事项"
}
```

**字段约定：**
- `id`：`F` + 两位数字，全 phase 唯一
- `spec_ref`：**必填**（2026-07-19 起，机械门控）。指向 `requirements/` 下具体
  章节，格式 `<文件名>.md#R<n>`。缺失或指向不存在的文件/章节 → `claim` 和
  `verify` 都会拒绝（见 [requirement-author] 的四元组说明）。
- `priority`：越小越重要（1 = 阻断其他所有工作的最高优先级）
- `area`：对应代码平面（`orchestrator`/`tools`/`memory`/`agent-core`/`harness`/`ci`/`tooling`）
- `sprint`：未分配时为 `null`；由 `pnpm harness new-sprint --features` 分配
- `notes`：除依赖外，**标注本 feature 预计要改的共享文件热点**
  （如「会改 `apps/web/.../rooms/page.tsx`」）。多 agent 并行分派时以此判断
  parallel-safe：同文件热点的 feature 必须串行（前者合并后再派，见 L11 事故 #301/#299）。

---

## 常见反模式

| 反模式 | 问题 | 正确做法 |
|--------|------|---------|
| verification 只检查"文件存在" | 代码错误也能通过 | 加行为断言（HTTP/输出内容） |
| 一个 feature 跨越多个 area | 难以定位失败原因 | 按 area 拆分 |
| status 直接写 passing | 绕过了验证门控 | 只能通过 harness verify 升级 |
| notes 留空 | 下一轮 agent 没有上下文 | 写清楚依赖和注意事项 |
| verification 命令依赖本地服务已启动 | CI 环境失败 | 在 verification 前加启动步骤，或用独立的 setup 命令 |
| user_visible_behavior 里有本 feature 无法断言的行，静默跳过 | 契约缺口无人接盘（L10） | 在 notes 里显式写「该行为由 FXX 交付时断言」，并在 FXX 的 notes 里对应记录 |

---

## 架构知识：这一环在全链路里的位置

```
requirement-author（写 spec_ref + 草稿四元组）
        │  遵守本 skill 的粒度/字段/反模式规范
        ▼
feature_list.json（唯一权威）
        │
        ├──▶ verification-writer（打磨 verification 的可执行性/防假阳性）
        ├──▶ sprint-planner（读 notes 的热点标注判 parallel-safe，读 priority 排期）
        ├──▶ feature-implementer（读 user_visible_behavior 决定实现范围）
        └──▶ pnpm harness verify（执行 verification，门控 status → passing）
```

- **上游**：requirement-author 产出的候选 feature 草稿；本 skill 是它必须遵守的
  「写作规范」，不是独立产出环节。
- **下游**：`area` 字段决定代码平面归属，`notes` 里的热点标注是 sprint-planner
  判断并行安全的**唯一**依据（同热点必须串行，见 L11 事故 #301/#299）。
  `spec_ref` 缺失或指向不存在的章节，会在 `claim`/`verify` 两处被
  `spec-ref.ts` 机械拒绝——这条规则的权威定义在 requirement-author skill 与
  `spec-ref.ts` 本身，本 skill 只负责提醒字段必填，不复述解析规则。
- **机械门控**：`validate-fl`（feature_list 结构校验）、`pnpm harness verify`
  （执行 verification）、`pnpm harness doctor`（审计 evidence 真实性与派生视图
  一致性）都会在不同阶段重新触碰这里定义的字段。

---

## 领域/商业知识：为什么这样设计

**①为什么按「垂直切片」而不是技术层横切分 feature**：外部开源实践
（vertical slicing：一个 feature 应该贯穿 UI → API → 数据层交付一次完整的
用户可见价值，而不是「先写后端」「再写前端」这种按技术层横切的拆法）与本仓
`user_visible_behavior` 字段的设计目标完全一致——它要求描述的是**可观察结果**，
而横切出来的「纯后端」feature 往往写不出真正的用户可观察行为（只能写"接口能
调通"这种弱断言，正是反模式表里第一条"只检查文件存在"的同源问题）。写 feature
时优先问："这个 feature 单独合并，用户/下一个 feature 能看到什么变化？"
答不出来，大概率是切错了层。

**②feature flag 五分类法对 notes 热点标注的启发**：开源 feature flag 实践把
flag 分成 release/experiment/ops/permission/kill-switch 五类，健康代码库控制在
20-30 个活跃 flag 以内——核心思想是「每个可变更单元都要能说清自己是什么类型的
变更，否则数量一旦失控就没人能判断风险」。本仓没有运行时 flag 系统，但同样的
风险信号可以类比用在 feature 粒度上：写 feature 时问一句"这是新增能力
（≈release）、迁移/清理（≈ops）、权限调整（≈permission）还是高风险开关类
（≈kill-switch）"，风险类和权限类 feature 应该在 notes 里更详细地写清共享文件
热点与回滚方式，因为它们最容易在并行开发时和别的 feature 打架。

**verification 分级为什么优先高层出口（呼应 Testing Trophy）**：本表的分级
逻辑（HTTP/行为输出 > 文件内容 > 存在检查 > 无断言）与 Kent C. Dodds 提出的
Testing Trophy 思想一致——越接近用户可观察的出口，断言的 ROI 越高、越不容易
产生假阳性；纯粹检查内部实现细节（文件是否存在、函数是否被调用过）容易在
代码重构后误报通过或误报失败。verification-writer skill 有更详细的防假阳性
手法，本表只负责在写 feature 阶段就把断言层级选对，别留到验证阶段才发现
选错了断言对象。

---

## 分批填写建议（新项目启动时）

1. **第一批**：先写 3-5 个最高优先级 feature（知道这些必须做）
2. **分配 sprint-01**：只取前 2-3 个，保持 sprint 小而聚焦
3. **迭代补充**：每个 sprint 结束后再补下一批 feature

不要一次写完所有 feature——需求会变，过早细化是浪费。

---

## 迭代/进化机制：这个 skill 本身怎么变好

- **反模式表是 append-only 的事故沉淀点**：谁在写 feature 或 review 时踩到新的
  反模式（verification 看似合格实则假阳性、粒度判断失误导致会话中途交接失败等），
  在「常见反模式」表里追加一行，标注出处（issue/PR/postmortem），不要只在当次
  对话里口头提醒。
- **粒度经验值会漂移**：「4-8 小时」是经验值，不是物理常数——如果连续几个 sprint
  发现某类 feature 系统性偏大或偏小，回来更新这个数字并说明依据（哪几个
  feature、偏差多少），不要让经验值和实际脱节却没人改。
- **外部参照更新**：vertical slicing / feature flag 分类法 / Testing Trophy 是
  本 skill 现有设计依据；如果外部实践演化出更贴合本仓机械门控的说法，替换时
  同样走「新增一条 + 保留旧条追加删除线」的 append-only 记录方式。

<空，升级开始后追加>

