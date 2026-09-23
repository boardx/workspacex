# 实施 Backlog 与并行执行图

> 2026-09-23 · 汇总本系列全部研究的可执行项，标出依赖与可并行轨道。
> 来源：`open-source-business-model.md`（v32.8）、`devportal-positioning.md`、
> `oss-readiness-probe-2026-09-22.md`、三份迭代记录。

---

## 0. 两个词的统一（本版先做）

### ① 商业与分发单元：此前叫 MAAU → **技能包**

**不发明新词——仓库里早就有这个词。** `apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts`、
`pg-skill-starter-import-repository.ts`、`file-skill-starter-pack-source.ts` 都在用「skill pack」。
整个运行时围绕 skill 建：`skills/` 目录、`SKILL.md`、`capability_id`、`skill-sandbox`。

**此前的 MAAU 是在一个已有清晰名字的概念上又加了一层缩写。** 对外讲「技能包」所有人都懂，
讲「最小智能体可执行单元」需要先解释三十秒。

| 用法 | 处置 |
|---|---|
| **商业与分发单元**（此前的 MAAU） | 改叫**技能包**。开源方案、PPT、对外材料一律用它 |
| **MAAU 画布**（`maau-canvas` skill，WX-S021） | **保留**。它是一种设计方法——把一段讨论收敛成一个可执行单元的画布，与商业单元不是一回事 |
| 代码标识符（`@repo/maau-postinvest-report`、`capability_id`、目录名） | **本版不动**。标识符可以滞后于叫法；真要改另开 issue，波及 40 个代码文件 |

### ② 此前叫「我们自己的组织大脑」、后来叫「团队记忆」→ **平台大脑**

「组织大脑」在本仓已是**产品概念**（`brain-promotion`、`batchConfirmAndWriteBackToBrain`、
「来自组织大脑」数据源区块），指客户把产出物沉淀进本组织知识库的能力。

我们自己那份是**平台层面的记忆**：跨所有客户实例的运行事实，加上工作、创新与学习的全部积累
（ADR、sprint 历史、方法论、踩坑经验、GTM 与案例知识）。

此前改叫「团队记忆」，把它说小了——它不只装我们团队的东西。定为 **平台大脑**：
与组织大脑成**层级**，谁在上谁在下一眼就懂。

| | 产品的组织大脑 | 平台大脑 |
|---|---|---|
| 内容 | 客户的材料、结论、决策链 | 跨实例运行事实 + 工作 / 创新 / 学习的积累 |
| 承载 | `context-engine.md`：PG + pgvector，RLS 隔离 | 产品的组织大脑 + harness 元本体（开发过程那一半，放哪待 D17）；在可移植层，边缘只放投影 |
| 归属 | 产品，售卖 | 不交付 · 内部运营平面 |

两个词都要在 `PROJECT.md` 登记为单一事实源，并加一道 lint：文档里出现旧用法即红。

---

## 1. 并行轨道总图

**七条轨道，五条不依赖任何未决决策，可立即并行开工。**

```mermaid
flowchart LR
    classDef done fill:#DCEFE3,stroke:#2E7D4F,color:#14381F
    classDef ready fill:#E3EEF7,stroke:#1F5F8B,color:#10304A
    classDef block fill:#F8E1DF,stroke:#B3261E,color:#5A120E,stroke-dasharray:4 3
    classDef dec fill:#26323A,stroke:#26323A,color:#FFFFFF
    NOW(["现在"])
    A["A 命名统一<br/>4 / 4 已完成"]:::done
    C["C 门控建设<br/>8 项可开工 · 1 项等 C1"]:::ready
    D["D 运营平面<br/>8 项可开工 · 4 项在关键路径上"]:::ready
    E["E 产品 0→1<br/>6 项可开工 · 1 项等 E1+E2"]:::ready
    B["B 开源就绪<br/>4 项可开工 · 3 项等 D1"]:::ready
    F["F devportal<br/>2 项全等 D13"]:::block
    G{{"待人类决策<br/>D1 · D13 · D16 · D17"}}:::dec
    NOW -.-> A
    NOW ==> C
    NOW ==> D
    NOW ==> E
    NOW ==> B
    G -. "D1 挡 B6 B7 B8" .-> B
    G -. "D13 挡 F1" .-> F
    G -. "D16 挡 D9 · D17 挡 D12" .-> D
```

粗线是**现在就能开工**的轨道，虚线是被决策挡住的部分。
B 轨八项里只有三项要等决策，F 轨两项都要等，D 轨有两项分别等 D16 与 D17。

判据很简单：**一项工作要不要等决策，看它做完后决策改了要不要返工。**
盘点、门控、体验、运营面都不返工——决策怎么定它们都要做。

---

## 2. 完整依赖路径

42 项里只有 16 条依赖边，其余节点互不依赖，全部可并行。红色粗线是关键路径。

```mermaid
flowchart LR
    classDef done fill:#DCEFE3,stroke:#2E7D4F,color:#14381F
    classDef ready fill:#E3EEF7,stroke:#1F5F8B,color:#10304A
    classDef part fill:#E3EEF7,stroke:#1F5F8B,color:#10304A,stroke-width:2px,stroke-dasharray:6 2
    classDef wait fill:#FBF0D9,stroke:#A36A00,color:#4A3000
    classDef block fill:#F8E1DF,stroke:#B3261E,color:#5A120E,stroke-dasharray:4 3
    classDef dec fill:#26323A,stroke:#26323A,color:#FFFFFF
    classDef crit stroke:#B3261E,stroke-width:3px

    subgraph sK["待人类决策"]
        K1{{"D1 许可证<br/>不可逆"}}:::dec
        K13{{"D13 公开层去留"}}:::dec
        K16{{"D16 运行事实<br/>还是客户内容"}}:::dec
        K17{{"D17 开发过程知识<br/>放哪套图"}}:::dec
    end
    subgraph sA["A 命名统一"]
        A1["A1 商业单元改名技能包"]:::done
        A2["A2 → 平台大脑"]:::done
        A3["A3 PROJECT.md 登记"]:::done
        A4["A4 词汇门控"]:::done
    end
    subgraph sB["B 开源就绪"]
        B1["B1 依赖许可证盘点"]:::part
        B2["B2 第三方包定性"]:::ready
        B3["B3 完整 clone 凭据扫描"]:::part
        B4["B4 扫描报告落盘"]:::wait
        B5["B5 SECURITY.md 邮箱"]:::part
        B6["B6 license 字段"]:::block
        B7["B7 CLA / DCO"]:::block
        B8["B8 商标政策"]:::block
    end
    subgraph sC["C 门控建设"]
        C1["C1 补齐 18 处清单缺口"]:::ready
        C2["C2 清单门控转 strict"]:::wait
        C3["C3 OSS 不依赖 EE"]:::ready
        C4["C4 契约包边界"]:::ready
        C5["C5 运营 schema 白名单"]:::ready
        C6["C6 个人信息字段门控"]:::ready
        C7["C7 生产不依赖运营面"]:::ready
        C8["C8 零出网 e2e"]:::ready
        C9["C9 体验承诺登记表"]:::ready
    end
    subgraph sD["D 运营平面"]
        D5["D5 中国可达性实测"]:::ready
        D6["D6 Access 策略核对"]:::ready
        D7["D7 启用 CF_ACCESS_AUD"]:::ready
        D1["D1 运营面骨架"]:::ready
        D2["D2 GTM 与漏斗"]:::ready
        D3["D3 CRM 分层"]:::ready
        D4["D4 · S1 立我们自己的实例"]:::ready
        D8["D8 · S2 上报契约定稿"]:::ready
        D9["D9 · S3 实例侧上报器"]:::block
        D10["D10 · S4 边缘收集与投影"]:::wait
        D12["D12 建出路径所需的图节点与边"]:::block
        D11["D11 · S5 实例进平台大脑"]:::wait
    end
    subgraph sE["E 产品 0→1"]
        E1["E1 第一个价值时刻"]:::ready
        E2["E2 脱敏示例项目"]:::ready
        E3["E3 埋点并测量"]:::wait
        E4["E4 零出网可见化"]:::ready
        E5["E5 退出自由与导出"]:::ready
        E6["E6 18 个技能包收成 3 入口"]:::ready
        E7["E7 根级 compose"]:::ready
    end
    subgraph sF["F devportal"]
        F1["F1 公开层拆域"]:::block
        F2["F2 公开层接真后端"]:::wait
    end

    B3 --> B4
    K1 --> B6
    K1 --> B7
    K1 --> B8
    C1 --> C2
    E1 --> E3
    E2 --> E3
    K13 --> F1
    F1 --> F2
    D8 ==> D9
    K16 ==> D9
    D9 ==> D10
    D10 ==> D11
    D4 --> D11
    K17 ==> D12
    D12 ==> D11
    class D8,D9,D10,D11,D12 crit
    linkStyle 9,10,11,12,14,15 stroke:#B3261E,stroke-width:3px
```

⚠ **B6 曾被错列为无悔动作。** 写上 `"license": "Apache-2.0"` 就是在执行 D1，
而 D1 是不可逆决策。无悔的是**盘点**，不是**声明**。

---

## 3. Backlog 全表

状态：`□` 未开始 · `◐` 部分完成 · `■` 已完成

### 轨道 A · 命名统一（无依赖，最先做）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| A1 | 此前的 MAAU → 技能包，全文档替换 | ✅ | #3888 |
| A2 | 此前的「我们自己的组织大脑」「团队记忆」→ 平台大脑，全文档替换 | ✅ | #3888 起步，v32.7 定名 |
| A3 | 两词在 `PROJECT.md` 登记为单一事实源 | ✅ | |
| A4 | lint：文档出现旧用法即红 | ✅ | `lint-vocabulary.mjs`，已进 `verify:harness:raw` |

### 轨道 B · 开源就绪（3 项依赖决策）

| # | 项 | 状态 | 依赖 |
|---|---|---|---|
| B1 | 装依赖后重跑依赖许可证盘点 `--strict` | ◐ | 脚本已建 |
| B2 | `@firecrawl/anydoc` 等第三方包可再分发性定性 | □ | |
| B3 | 完整 clone 上重跑凭据扫描，人工确认候选项 | ◐ | 脚本已建 |
| B4 | 凭据扫描报告落盘 | □ | B3 |
| B5 | 填 `SECURITY.md` 安全联系邮箱 | ◐ | 文件已建 |
| B6 | 补 `package.json` 的 `license` 字段 | □ | **D1** |
| B7 | CLA 或 DCO 落地 | □ | **D6** |
| B8 | 商标政策 | □ | **D1** |

### 轨道 C · 门控建设（九项彼此独立）

| # | 项 | 状态 | 依赖 |
|---|---|---|---|
| C1 | 补齐 18 处技能包清单缺口 | □ | 门控已报出明细 |
| C2 | 清单门控转 `--strict` 接 CI | □ | **C1** |
| C3 | `lint-ee-boundary`（OSS 不依赖 EE） | □ | |
| C4 | 契约包不依赖内容包的边界检查 | □ | |
| C5 | 运营平面 schema 白名单门控 | □ | |
| C6 | 运营平面个人信息字段级门控 | □ | |
| C7 | 生产不依赖运营平面的依赖方向检查 | □ | |
| C8 | 本地零出网拔网 e2e | □ | |
| C9 | 体验承诺登记表 + 字段完整性门控 | □ | |

### 轨道 D · 运营平面（Cloudflare）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| D1 | 运营面骨架：发布控制台 + 事故面板 | □ | 复用既有 Workers 部署流水线 |
| D2 | GTM 活动与漏斗（只放聚合与 ID） | □ | |
| D3 | CRM：边缘存 ID、源站存个人信息 | □ | 详情页回源 |
| D4 | 平台大脑落位：**S1 立一个真实 WorkspaceX 实例跑我们自己的组织**，现有 ADR / 方法论 / 经验迁进它的本体表，平台大脑从这里起步 | □ | **无依赖**——D14 已定（v32.6：既是也不是，三层分开）。见 `super-instance-design.md` |
| D8 | **S2 上报契约定稿**：schema + 四项同意 + `personal-local` 排除 + 字段白名单门控 | □ | 无依赖，可与 D4 并行 |
| D9 | S3 客户实例侧上报器（出站、可关、可看见传了什么） | □ | D8；**等 D16** |
| D10 | S4 边缘收集与投影：Workers 收、DO 聚合、Pages 呈现车队 | □ | D9 |
| D12 | 建出六跳路径所需的图节点与边：客户实例、版本、缺陷、PR（v32.8 补：此前误以为已存在） | □ | **等 D17**；`ontology_edges` 的节点 kind 由 CHECK 写死，要改迁移 |
| D11 | S5 客户实例进组织大脑成一等实体，接六跳路径检索 | □ | D4 D10 **D12** |
| D5 | 中国可达性实测 | □ | **必须实测，不可假设** |
| D6 | Cloudflare Access 策略核对 | □ | 仓库无声明，控制台才是事实源 |
| D7 | 启用 `CF_ACCESS_AUD` | □ | 安全待办，独立于定位 |

### 轨道 E · 产品 0→1 体验

| # | 项 | 状态 | 依赖 |
|---|---|---|---|
| E1 | 定义第一个价值时刻 + 事件定义 | □ | |
| E2 | 内置脱敏示例项目 | □ | |
| E3 | 埋点并测量 | □ | **E1 + E2** |
| E4 | 零出网做成用户可见状态 | □ | 卖点不可见等于没有 |
| E5 | 退出自由承诺 + 导出命令 | □ | |
| E6 | 18 个技能包收敛成 3 个入口 | □ | 选择过载 |
| E7 | 根级 compose + 升级命令 | □ | 5 个分应用 compose 已存在，是组合 |

### 轨道 F · devportal

| # | 项 | 状态 | 依赖 |
|---|---|---|---|
| F1 | 公开层拆域 | □ | **D13** |
| F2 | 公开层接真实后端 | □ | F1；现为 mock |

### 轨道 G · 人类决策

| # | 决策 | 可逆性 | 挡住什么 |
|---|---|---|---|
| G1 | D7 开源目的 · D0 是否开源 | 高 / 中 | 方向，不挡具体执行 |
| G2 | D1 许可证 | **不可逆** | B6 B7 B8 |
| G3 | D4 内容处置 | 高 | 无（H1 主线，但不挡其他轨道） |
| G4 | D13 公开层去留 | 中 | F1 F2 |
| ~~G5~~ | ~~D14 平台大脑是否用自家产品~~ | — | **已定（v32.6）**：既是也不是，三层分开。D4 D8 解锁 |
| **G7** | **D16 联邦运营的是运行事实还是客户内容** | **极低**（是商业模式换道） | S3 之后全部（D9 D10 D11） |
| **G8** | **D17 平台大脑开发过程那一半放哪套图** | 中 | D12 → D11。三种读法见 `super-instance-design.md` §2.2 |
| G6 | D2 D3 D5 D8 D9 D10 D11 D12 D15 | 多为高 | 不挡执行 |

---

## 4. 排布：AI 开发约 3 周（原按人类估算 13 周）

全部改由 AI 开发后，写代码从「周」降到「小时到天」，**瓶颈移到了人**。三周的前提是每个人类关口一个工作日内答复——关口拖一天，整体拖一天。

| AI 加速不了的关口 | 涉及项 | 为什么 |
|---|---|---|
| **决策** | D1 · D13 · D16 · D17，及 E1、C1 的许可证部分 | 商业与法律选择。C1 给 13 个自研技能包填许可证就是在执行 D1 |
| **设计签核** | S2 契约、运营面骨架、GTM、CRM、E4 E5 E6 | 仓库硬约束：契约束开工前人类签核，agent 不许改签核状态 |
| **实测与权限** | D4 D5 D6 D7、B3 凭据候选确认、B5 邮箱 | 要人的身份、网络位置或凭据 |
| **PR 合并** | 约 50 个 PR | 一个 issue 一个 PR、不许合批；实测 PR 开出到合入 47 分到 5 时 19 分 |

新关键路径有两条，都起于决策：**D16 → S3 → S4 → S5**，与 **D17 → D12 建图 → S5**。D16 必须挪到第 1 周。

```mermaid
gantt
    title AI 开发重估：约 3 周（假设每个人类关口 1 个工作日内答复）
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    section 人类关口
    D1 · D13 · D16 · D17 决策        :crit, h1, 2026-09-24, 2d
    S2 契约签核               :crit, h2, after s2d, 1d
    实测与权限 D4 D5 D6 D7      :h3, 2026-09-24, 3d
    凭据候选人工确认 B3         :h4, 2026-09-24, 1d
    section 关键路径（AI 执行）
    S2 契约起草               :s2d, 2026-09-24, 1d
    S3 实例侧上报器            :crit, s3, after h1 h2, 2d
    S4 边缘收集与投影           :crit, s4, after s3, 3d
    D12 建出路径图（此前漏算）      :crit, ont, 2026-09-25, 10d
    S5 实例进平台大脑           :crit, s5, after s4 ont, 3d
    section 可并行（AI 执行）
    C 门控八道                :c, 2026-09-24, 3d
    B 盘点与扫描              :b, 2026-09-24, 2d
    E 体验六项（含签核）        :e, 2026-09-24, 6d
    D 运营面骨架 GTM CRM（含签核）:d, 2026-09-25, 7d
    section 人工审查
    约 50 个 PR 逐个合并        :rv, 2026-09-24, 15d
```

原来按人类开发估算的十三周排布保留作对照：

```mermaid
gantt
    title 原排布：按人类开发估算（S 期时长为估算，未算入 D12 建图）
    dateFormat X
    axisFormat 第%s周
    section A 命名
    两词替换与登记          :done, a1, 0, 1w
    词汇门控               :done, a2, after a1, 1w
    section D 关键路径
    S2 上报契约定稿         :crit, d8, 0, 3w
    D16 必须已定           :milestone, crit, g16, after d8, 0d
    S3 实例侧上报器         :crit, d9, after d8, 3w
    S4 边缘收集与投影       :crit, d10, after d9, 4w
    S5 实例进平台大脑       :crit, d11, after d10, 3w
    section D 运营面
    S1 立我们自己的实例      :d4, 0, 4w
    中国可达性实测          :d5, 0, 1w
    Access 策略核对        :d6, 0, 1w
    运营面骨架             :d1, 1, 4w
    GTM 与漏斗            :d2, 4, 4w
    CRM 分层              :d3, 6, 4w
    section C 门控
    补齐清单 18 处          :c1, 0, 2w
    转 strict 接 CI       :c2, after c1, 1w
    边界与依赖方向四道       :c3, 1, 4w
    零出网 e2e            :c8, 3, 2w
    section E 体验
    第一个价值时刻定义       :e1, 0, 2w
    脱敏示例项目           :e2, 1, 3w
    埋点并测量             :e3, after e2, 2w
    零出网可见化           :e4, 3, 2w
    退出自由与导出          :e5, 4, 3w
    根级 compose          :e7, 8, 4w
    section B 开源就绪
    依赖许可证盘点          :b1, 0, 2w
    完整 clone 凭据扫描     :b3, 0, 2w
    第三方包定性           :b2, 2, 2w
```

按人类估算时第 6 周设硬性复盘点；按 AI 估算，复盘点应提到第 1 周末——那时四个决策应已定下，否则关键路径已经在滑。

---

## 5. 加快实施的三条判据

1. **不依赖未决决策的先做。** 七条轨道里五条如此——A、C、D、E 全部，B 的 5/8。
   等决策是本方案最大的潜在浪费。
2. **门控可以一道一道上。** 九道彼此独立，不必攒齐再接 CI。
   已建三道（清单、依赖盘点、凭据扫描），做一道划掉一道。
3. **实测类的最先做，因为它们可能推翻计划。**
   中国可达性、Access 策略核对、依赖许可证分布——这三项若结果不利，
   会改变后面几周的安排。**第 1 周就做完，不要拖到需要它们的时候。**

---

## 6. 会推翻计划的事（D14 已答，D16 D17 待答）

| 事 | 若结果不利 | 现在能做什么 |
|---|---|---|
| ~~D14：平台大脑用不用自家产品~~ | ~~用了它就在产品栈，D4 作废~~ | **已答（v32.6）：既是也不是，三层分开。D4 D8 可开工** |
| **D16：联邦运营的是运行事实还是客户内容** | 若是客户内容，开源方案的归属表、数据边界、对自托管客户的全部承诺一起作废 | S1 S2 不受影响，先做这两期 |
| **D17：开发过程知识放哪套图** | 选了 C（整体搬进产品），违反「仓库即唯一事实来源」 | 推荐 B：同步投影进产品，权威仍是仓库文件 |
| **中国可达性** | 运营人员连不上，整个运营面要另备旁路 | 第 1 周实测 |
| **依赖许可证分布** | 出现不可再分发的包，开源前必须替换 | 第 1 周装依赖重跑 |
