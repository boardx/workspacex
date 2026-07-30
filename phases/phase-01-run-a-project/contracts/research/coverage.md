# 契约束 `research` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：**（无 —— 尚未生成）**。束↔feature 映射的权威是 `design-signoff.md`
> frontmatter 的 `covers:`（ADR-023 决策三），现在是 `[]`。
>
> 依据 UC：`24-research/uc-24-1` … `uc-24-5`（**5 份**）。
> R12 验收线索合计 **41 条**：
> `uc-24-1: 9 · uc-24-2: 8 · uc-24-3: 7 · uc-24-4: 9 · uc-24-5: 8`。

---

## 🔴 本文现在不是覆盖证明，是**覆盖缺口清单**

按 `verify-uc-coverage` 的两个方向：

- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

**本束现在两个方向都不成立**，原因**不是材料没写完**：

| 阻塞 | 后果 |
|---|---|
| **Q-8 未裁**（实体分一层还是两层） | `usecases.md` 第三节那 5 个端口是否存在都未定；且 1.1 / 2.1 的**主体是哪个实体**未定。给它们做覆盖映射 = 给一个形状未定的模型做证明 |
| **Q-2 未裁**（`/studio/research` 路由被 UC-0.2 占用） | **前端消费点这一列填不出来**——本束的屏落在哪个路由上都还没定 |
| **feature 未生成** | `covers: []`。覆盖证明的粒度是 feature，没有 feature 就没有可映射的对象 |
| **Q-10 / Q-12 / Q-7 未裁**（三个枚举） | `status` / `disposition` / `SourceKind` 三个闭集的值域未定 ⇒ 任何涉及它们的断言都写不成机械判据 |
| **截图目录未产出** | 第 ① 件材料为空，`ui.md` 无法给出「哪一屏对应哪条线索」 |

⇒ **本文现在的正确状态是「缺口清单」，不是「覆盖表」。**
按本仓纪律（`contracts/project/design-signoff.md` 与 `contracts/asset-governance/coverage.md` 的先例），
**宁可让缺口有名字、会在每次 `doctor` 里出现，也不要为了消红填一张假的映射表。**

---

## 一、可以现在就做覆盖映射的部分（与 Q-8 / Q-2 无关）

> 这一组线索无论 Q-8 / Q-2 怎么裁都成立——它们断言的是**不变量**，不是实体层数或路由。
> 「前端消费点」列填**真实 `data-testid` 或路由**；填不出来的标 **未建**，**但不能空着**。

### 本域的硬门槛（`uc-24-4` R12 第 1–3 条 · `uc-24-2` R12 第 2–3 条）

| UC / R12 | 线索 | 端口 | 前端消费点 | 状态 |
|---|---|---|---|---|
| 24-4 / 1 | 无外部来源 ⇒ 入库被阻断（**N-1**） | `PromoteConclusionToInsight` → `NO_EXTERNAL_SOURCE` | **未建** | ❌ 端口未实现 |
| 24-4 / 2 | 「争议 / 不确定」条目无入库入口（**N-2**） | 同上 → `EVIDENCE_IS_DISPUTED` | **未建** | ❌ |
| 24-4 / 3 | 低置信来源入库后**仍带标注**（**N-3**） | 同上（后置条件） | **未建** | ❌ |
| 24-2 / 2 | 置信度 0.3 的来源**不被过滤**（**N-3**） | `GetResearchDetail` 段 ③ | **未建** | ❌ |
| 24-2 / 3 | 单来源结论落进「争议 / 不确定」（N-2 的生产侧） | `RunResearch` 后置 | **未建** | ❌ |
| 24-2 / 8 | 检索不越出 `sourcePrefs`（**N-4**） | `RunResearch` → `SOURCE_PREF_VIOLATION` | **未建** | ❌ |
| 24-5 / 4 | 冲突未判定 ⇒ 两结论停在「争议」且入库被阻（**N-5**） | `PromoteConclusionToInsight` → `CONFLICT_PENDING_HUMAN` | **未建** | ❌ |
| 24-5 / 5 | 三个判定动作**无预选、无倒计时**（**N-6**） | `ListConflicts` 返回不带预选态 | **未建** | ❌ |
| 24-3 / 4 | 归档后仍可检索，被引证据不失效（**N-7**） | `ArchiveResearch` | **未建** | ❌ |
| 24-3 / 3 | 目标缺失渲染 `—` 而非 `0`（**N-8**） | `GetResearchPlan` 返回 `null` | **未建** | ❌ |
| 24-5 / 6 | 提出方留痕 + 判定留痕（**N-9**） | `CreateResearch` / `ResolveConflict` | **未建** | ❌ |
| 24-1 / 8 · 24-2 / 7 · 24-4 / 8 · 24-5 / 8 | 观察者出口动作集合 = 空集（**N-10**） | 各写端口 → `FORBIDDEN_ROLE` | **未建** | ❌ |
| 24-4 / 9 | 入库产出的是**候选**洞察（**N-11**） | `PromoteConclusionToInsight` 返回类型 | **未建** | ❌ |
| 24-1 / 2 | 七组字段默认值逐项正确（`domain.md` 1.4–1.7） | `CreateResearch` 的默认 | **未建** | ❌ |
| 24-1 / 6 | Scout 不可用时研究仍创建成功 | `CreateResearch` 不因 `MODEL_UNAVAILABLE` 失败 | **未建** | ❌ |
| 24-4 / 6 | 节点消失 ⇒ 入库成功 + 回流失败原因可读（**部分成功**） | `PromoteConclusionToInsight` 的双返回 | **未建** | ❌ |
| 24-4 / 7 | 下游 500 ⇒ 不显示已入库（禁乐观 UI） | 同上 | **未建** | ❌ |

**小计：本域 17 条硬门槛线索，端口 0 条已实现、前端 0 处已建。**

⚠ 这不是悲观陈述，是**真实状态**：`apps/web/components/research/` 服务的是 UC-0.2 Context Pack，
与上表任何一条都不对应（`requirements/24-research/00-index.md` 的对照表，机械核实
`grep -c "研究场景\|时间盒\|桌面研究\|…" lib/mock/research.ts` → **0**）。

---

## 二、被 Q-8 / Q-2 阻塞、现在**不做**映射的部分

| UC | 线索数 | 阻塞于 |
|---|---:|---|
| `uc-24-3` 的列表层级与三计数归属 | 4 | **Q-8** |
| 全部线索的「前端消费点」列 | 41 | **Q-2**（路由未定，`data-testid` 无处锚定）|
| 涉及 `status` 的断言（24-3 / 1、24-5 / 1、24-5 / 2） | 3 | **Q-10** |
| 涉及「去向」的断言（24-3 / 7） | 1 | **Q-12** |
| 涉及来源类别计数的断言（24-2 / 8 的分类维度） | 1 | **Q-7** |

⚠ **不要为了让这张表看起来完整而先填一个猜测的路由或 `data-testid`。**
`skills` 束栽过一次同形的坑：ui.md 按约定写了 14 个**设想的**文件名，14 条全是死链
（留痕在 `contracts/skills/ui.md` 顶部）。**同样的错不在这里犯第二次。**

---

## 三、反方向：API → UC（有没有多余的端口）

逐个核过 `usecases.md` 第一、二节的 **12 个端口**，**每一个都有 UC 要它**：

| 端口 | 被哪条 UC 要 |
|---|---|
| `CreateResearch` | 24-1 R3 |
| `RunResearch` / `RetryResearch` | 24-1 E1 · 24-2 R3 |
| `AskFollowUp` | 24-2 R2 触发条件 |
| `PromoteConclusionToInsight` | 24-4 R3 |
| `ResolveConflict` | 24-5 R3.6 |
| `ArchiveResearch` | 24-3 R3.B.4 |
| `CopyResearch` | 24-3 R3.B.4（**但 Q-4 未裁前不实现**）|
| `PinResearch` | 24-3 A2（**Q-13**）|
| `ListResearch` | 24-3 R3.A/B/C |
| `GetResearchPlan` | 24-3 R3.D |
| `GetResearchDetail` | 24-2 R3 |
| `ListLiveResearchTasks` / `ListConflicts` | 24-5 R3 |

**无多余端口。** 第三节那 5 个「随裁决增删」的端口**故意没有签名**，
因此不参与本方向的判定——它们现在还不是端口，是**登记在案的未定项**。

---

## 四、解除本文这条红的路径（顺序不可颠倒）

1. 人类裁 `OPEN-QUESTIONS.md`（**至少 Q-2 / Q-8 / Q-10 / Q-12 / Q-7 这五条**）。
2. 按裁决回改 `domain.md` / `usecases.md`。
3. **ui-prototyper** 产出 `ui-preview/research/`，回填 `ui.md` 与真实 `data-testid`。
4. **requirement-author** 生成 feature，填进 `feature_list.json` 与 `design-signoff.md` 的 `covers:`。
5. 回到本文，把第一节的「未建」逐个换成真实消费点，把第二节的行迁进第一节。
6. **然后**本文才成为覆盖**证明**。

⚠ **不要跳过 1 直接做 5。** 那会产出一张「映射到猜测路由」的表，
比现在这张诚实的缺口清单糟得多。
