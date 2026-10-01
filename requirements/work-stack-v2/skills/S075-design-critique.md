# S075 — Design Critique（设计评审意见）

> Type: Work Skill · Domain: Product & Design · Strategy: A1（两源择优合并）· 目标通道：candidate → verified（ADR-119 G5）
> 本文独立作者化（AUTHOR-S075）。基线：`main@30c1c4332025151610502988b0379b95ff7298c7`（下称「基线」）。凡是提到 WorkspaceX 代码的地方，都在基线上用 `git show <基线>:<path>` 读过；没读过的标 **UNVERIFIED**，现在还不存在或没接线的能力标 **proposed-unwired**。
> 注：ADR-116…121 在基线 commit 里**不存在**（`git show <基线>:docs/adr/ADR-118-…` 报 path not in commit），只在当前工作树里有。本文引用的是工作树里的版本，标 UNVERIFIED@baseline。

## 1. 这个 Skill 解决什么问题
给一个**已经画出来**的界面（WorkspaceX 设计工作台的原型页、一张截图，或一段文字描述），产出一份**锚定到具体元素、按阶段过滤严重度、并把「测出来的」和「推断出来的」分开写**的评审意见 `DesignCritiqueReport`。

S075 **不做**的事：
- 不改设计。它不产出 patch，也不调用原型写回（决策 3）。
- 不做可用性测试，也不假装知道「用户会怎么想」。凡是用户行为层面的判断，只能写成待验证假设，交给 S009 Customer Research / S062 去验证（决策 5）。
- 不给整页打一个总分。基线里已经有 `prototype-quality.ts` 的结构分，S075 只引用它，不再造一个分数（决策 4）。

## 2. 图上的消费者（逐条从矩阵读出）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
**没有。** S075 不在任何一行的 Exact Skills 里。W027–W032（第 33–38 行）这些 Product Workflow 也都不含 S075。
所以按 ADR-118 决策 9（UNVERIFIED@baseline），S075 只在对话里被直接调用；所有 Workflow 阶段里都不会固定它的版本。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，都在 Skill 列）
| 角色 | 矩阵行 | 该角色的 Workflow 列 | 缺省 `critiqueLens` |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | `product-fit`：先看主任务能不能完成、和 PRD 的验收标准对不对得上 |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | `human-centered`：先看界面和 persona / 旅程阶段对不对得上，HMW 能不能落到这页 |

两个角色用的是同一份 Skill，差别只在输入的 `critiqueLens` 缺省值（§5），不会复制出两份 Skill。
这两个角色拥有的 Workflow 都不固定 S075，所以它们在 Workflow 阶段内**不能**调用 S075。要不要把 S075 加进 W029，见 §13 提议 1。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`） | `design/skills/design-critique/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`design/` 目录没有自己的 LICENSE，所以取仓根 `LICENSE`） | adapt：沿用五个维度（第一印象 / 可用性 / 视觉层级 / 一致性 / 无障碍）和「严重度随阶段变化」这条原则。**不采用**的部分：emoji 三档严重度（换成 0–4 档，决策 1）；「Suggest alternatives」无条件给方案（改成可选，并与 S075 解耦，决策 3）；「emotional reaction」（没有证据来源，决策 5） |
| github/awesome-copilot（本地克隆 `scratchpad/upstream/awesome-copilot`） | `skills/web-design-reviewer/SKILL.md`、`references/visual-checklist.md` | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（skill 目录没有自己的 LICENSE，所以取仓根 `LICENSE`，Copyright GitHub, Inc.） | reference-only：借「断点逐档检查」「溢出 / 裁切类问题要能指到具体位置」两点。**不采用**它「Step 3: Issue Fixing，改源码」这一步（决策 3） |
| Nielsen Norman Group「10 Usability Heuristics」与 0–4 severity rating（nngroup.com 文章） | — | 非代码仓库，没有 SHA | 版权文章，没有开放许可 | reference-only：只用 H1–H10 的**编号和名称**作为 `heuristicRef` 的枚举，以及 0–4 档的定义；不复制正文 |
| W3C WCAG 2.2（Recommendation, 2023-10-05） | SC 1.4.3 / 1.4.11 / 2.5.8 / 1.1.1 / 2.4.7 | 标准文本，没有 SHA | W3C Document License | reference-only：只引用 SC 编号和阈值（4.5:1、3:1、24×24 CSS px） |

- Apache-2.0 来源的 NOTICE 和改动说明写在 SKILL.md 的 `references/upstream.md` 里（Apache-2.0 §4(b)(c)），不复制上游段落。
- A1 双源：kwp 提供维度框架，awesome-copilot 提供「定位到具体位置」的纪律；NN/g 和 WCAG 提供评判标准。

## 4. 专业方法（S075 专属步骤）
1. **M1 锁定评审对象与阶段**：先把 `artifact` 解析成一个不可变的快照 id（原型用 `projectId + versionId + frameIndex`，图片用 `assetVersionId`）。后面每条 finding 都引用这个快照，事后能复查「评的是哪一版」。没有 `stage` 就拒绝执行（`STAGE_REQUIRED`），不去猜阶段。
2. **M2 声明主任务**：从 `context.primaryTask` 读出「这一页让谁完成什么」。缺了这项，可用性维度只能打 `inferred`，并且整份报告标 `taskUnstated=true`。
3. **M3 两秒扫描（第一印象）**：只记录客观可复现的一件事——视觉权重最高的前 3 个元素（原型模式下按字号 × 面积 × 对比度排序，算法见 `scripts/salience.mjs`，proposed-unwired），再和 `primaryTask` 对应的元素比。主 CTA 不在前 3 名 → 产出一条 `hierarchy` finding。不写「情绪反应」。
4. **M4 逐维度走查**：维度固定为 `usability | hierarchy | consistency | accessibility | content`。每条 finding 必须满足四件事：
   - 有锚点：原型模式用 `nodeId`，图片模式用归一化 `bbox`，描述模式用 `quotedSpan`；
   - 挂一个 `heuristicRef`（H1–H10 或 WCAG SC 编号，或者 `design-system:<tokenKey>`）；
   - 写「违反了什么」和「为什么对这个主任务有影响」；
   - 标 `evidenceKind`（决策 2）。
5. **M5 一致性对照设计系统**：原型模式下读项目的 `DesignTokens`（基线：`packages/contracts/src/design-workbench.ts:322`，字段为 `brand/font/radius/density`），找出和 token 不一致的节点。基线 token 没覆盖的维度（间距、阴影）不报「违反设计系统」，只能报「页内不一致」（同类元素取值不同）。
   - **圆角换算（不换算成像素）**：`radius` 是档位枚举 `PrototypeRadiusScale = "sharp"|"default"|"round"`（基线 `design-workbench.ts:307`；`DesignTokens` 为 `.strict()`，其他值解析即失败）。基线把「项目档位 × 节点 `radius`（none/sm/md/lg/full）」映射成**命名圆角类**的常量是 `RADIUS_BY_SCALE`（`apps/web/components/design-loop/prototype-canvas.tsx:420`），例如 `sharp` 下 sm/md/lg 全部落到 `rounded-none`、`full` 始终 `rounded-full`。M5 的比较单位就是这个类名：节点期望类 = `RADIUS_BY_SCALE[tokens.radius][node.radius]`，与节点实际渲染类不同即报。像素值不参与比较——`rounded-control/card/container` 取自 CSS 变量（`apps/web/tailwind.config.ts:46` 起），基线没有导出「档位→px」的常量；若将来需要按 px 比较，那是 proposed-unwired，本 skill 不依赖它。
   - 只有「节点实际类」可从原型节点树读到时 M5 才对圆角出结论；从截图推圆角像素的路径 proposed-unwired，本版不做。
6. **M6 无障碍的可测部分**：
   - 对比度只在能拿到前景色和背景色**确切值**时计算（原型节点样式 + token 解析出的颜色）。截图模式下一律标 `unmeasured`，不从像素估算（决策 2）；
   - 触控目标按 WCAG 2.5.8 的 24×24 CSS px 判定；
   - 图片检查有没有替代文本。
7. **M7 按阶段过滤**：按决策 1 的表，把低于当前阶段门槛的 finding 移到 `deferred[]`，不删。
8. **M8 优点与保留项**：至少写 1 条 `strengths`，并且要锚定到元素（「好看」这种不算）。评审建议里可能会改掉某个优点时，在对应 finding 的 `preserves` 字段里写明。
9. **M9 引用结构自审**：原型模式下如果能拿到 `prototype-quality.ts` 的 `QualityDeduction[]`（基线确有 `substance / hierarchy / emptyContainers / affordance` 这几项 metric），就原样放进 `structuralSignals`，不重算、不合并成 S075 自己的分数。

## 5. 输入契约（`inputSchema`）
```ts
type DesignCritiqueInput = {
  artifact:
    | { kind: "wx-prototype"; projectId: string; versionId: string; frameIndex: number }
    | { kind: "image"; assetVersionId: string; viewportCssPx?: { w: number; h: number } }
    | { kind: "description"; text: string }            // ≤ 8000 字
    | { kind: "figma-url"; url: string };              // proposed-unwired：目前没有 Figma 连接器，见 §9
  stage: "exploration" | "refinement" | "final";        // 必填
  context: {
    primaryTask?: string;                               // 「谁要完成什么」
    audience?: string;
    platform?: "web-desktop" | "web-mobile" | "native-ios" | "native-android";
    prdRef?: { docId: string; acceptanceCriteriaIds?: string[] };   // D003 常用
    personaRef?: { docId: string; journeyStage?: string };          // D011 常用
  };
  focus?: Array<"usability"|"hierarchy"|"consistency"|"accessibility"|"content">;
  critiqueLens?: "product-fit" | "human-centered" | "neutral";   // 缺省从调用角色映射（§2.2），再缺省 neutral
  locale: "zh-CN" | "en-US";
  jurisdiction?: "CN" | "US" | "both";                  // 影响 §8 的无障碍 / 合规检查项
  maxFindings?: number;                                 // 默认 12，上限 25
};
```
输入不变量：
- I1：`artifact.kind="wx-prototype"` 时，`versionId` 必须属于 `projectId`。
- I2：`focus` 只收窄走查维度，**不能**关掉 `accessibility` 里 severity ≥3 的检查（这类问题照样报，但标 `outOfFocus=true`）。
- I3：`prdRef` 和 `personaRef` 只作为读取依据，S075 不回写它们。

## 6. 输出契约（`DesignCritiqueReport`）
```ts
type DesignCritiqueReport = {
  schemaVersion: "S075/1";
  snapshot: { kind: string; ref: string; resolvedAt: string };   // M1
  stage: "exploration" | "refinement" | "final";
  taskUnstated: boolean;
  firstImpression: { topSalient: Array<{ anchor: Anchor; rank: 1|2|3 }>; primaryCtaRank: number | null; method: "computed" | "inferred" };
  findings: Finding[];            // 按 severity 降序，同级按 dimension 固定序
  deferred: Finding[];            // M7 移出的
  strengths: Array<{ anchor: Anchor; what: string; heuristicRef?: string }>;   // ≥1
  structuralSignals?: Array<{ metric: string; score: number; hint: string }>;  // M9 原样
  unmeasured: Array<{ check: "contrast"|"target-size"|"alt-text"|"responsive"; reason: string }>;
  hypothesesForResearch: Array<{ statement: string; suggestedMethod: "usability-test"|"interview"|"analytics" }>;  // 决策 5
};
type Anchor =
  | { type: "node"; nodeId: string; frameIndex: number }
  | { type: "bbox"; x: number; y: number; w: number; h: number }   // 0–1 归一化
  | { type: "span"; quotedSpan: string };
type Finding = {
  findingId: string;              // 在快照内稳定：hash(snapshot.ref, anchor, heuristicRef)
  dimension: "usability"|"hierarchy"|"consistency"|"accessibility"|"content";
  anchor: Anchor;
  heuristicRef: string;           // "NNG-H4" | "WCAG-1.4.3" | "design-system:radius" | "intra-page"
  issue: string;                  // 违反了什么（可观察的）
  impact: string;                 // 对 primaryTask 的影响
  severity: 0 | 1 | 2 | 3 | 4;
  evidenceKind: "measured" | "observed" | "inferred";
  measurement?: { metric: string; value: number; threshold: number; unit: string };   // 只有 measured 才有
  suggestion?: string;            // 可选、一句话方向，不是 patch
  preserves?: string[];           // 可能被这条建议伤到的 strengths 下标
  outOfFocus?: boolean;
};
```
输出不变量：
- O1：`evidenceKind="measured"` ⇔ 有 `measurement`；截图模式下 `heuristicRef` 以 `WCAG-1.4.3` / `1.4.11` 开头的 finding 不能是 `measured`。
- O2：每个 `anchor.nodeId` 都必须存在于快照的原型树里（校验器会遍历这棵树）。
- O3：`findings` 里没有 severity 低于决策 1 阶段门槛的项；被过滤的项全部进了 `deferred`，两者合起来就是全集。
- O4：`issue` / `impact` 里不得出现「用户会觉得 / 用户喜欢」这类断言；这类内容只能进 `hypothesesForResearch`（grader 用关键词表 + 模型判定双重检查）。
- O5：不出现整页总分字段。

类型化错误（`S075Error`）：
| code | 条件 |
|---|---|
| `STAGE_REQUIRED` | 没有 `stage` |
| `ARTIFACT_NOT_FOUND` | 快照解析失败（服务端查无此项目 / 版本 / 资产） |
| `ARTIFACT_FORBIDDEN` | 服务端判定调用者不可读（§7） |
| `VERSION_PROJECT_MISMATCH` | 违反 I1 |
| `UNSUPPORTED_ARTIFACT` | `figma-url`（在连接器接线之前一律返回这个错误） |
| `DESCRIPTION_TOO_THIN` | 描述模式下文本 < 40 字，或者说不出任何一个具体元素 |
| `ANCHOR_UNRESOLVED` | 输出自检发现违反 O2（内部错误，不返回半成品） |

## 7. 服务端授权边界
- **调用方声明的**（一律不可信）：`projectId`、`versionId`、`assetVersionId`、`critiqueLens`、调用角色。
- **服务端核实的**：
  - 组织和用户身份来自会话，而不是输入。
  - 原型可读性：用设计工作台现有的项目可见性规则判定。基线 `design-comments.ts` 头注写的是「读：全组织（同项目可见性）」，`project-shared.ts` 有 `DesignProjectNotFoundError`。S075 通过读端口复用这套判定，查不到时统一返回 `ARTIFACT_NOT_FOUND`，不区分「不存在」和「无权」，避免泄露项目是否存在。读端口本身是 proposed-unwired：目前还没有供 Skill 调用的 design-workbench 读端口。
  - `prdRef` / `personaRef`：只有调用者能读到这篇文档时才读；读不到就把它当作没提供，并在 `unmeasured` 里写原因。不会因此报错中断。
- **写**：S075 没有写能力，riskClass = low。把 findings 落成设计批注（基线 `design-comments.ts` 的 pin 批注：nodeId + frameIndex）是**调用方在 S075 之后的独立动作**，不在 S075 的权限内。要不要做成一键落批注，见 §14。

## 8. CN / US 差异（实质性的部分）
| 项 | CN | US |
|---|---|---|
| 无障碍基线 | GB/T 37668-2019《信息技术 互联网内容无障碍可访问性技术要求与测试方法》（对应 WCAG 2.0 AA）；面向老年用户的产品还要看工信部 2020–2021 年「互联网应用适老化」专项的要求（大字模式、无诱导广告弹窗）。UNVERIFIED：具体条款号，由方法评审人核对 | Section 508（联邦采购）与 ADA Title III 诉讼实践普遍引用 WCAG 2.1 AA；2024 年 DOJ Title II 规则指向 WCAG 2.1 AA |
| 同意 / 隐私 UI | PIPL 第 29、23 条：敏感信息和向第三方提供要「单独同意」。捆绑在一个总勾选框里 → severity 4（`heuristicRef="CN-PIPL-separate-consent"`） | CCPA/CPRA 要求「Do Not Sell or Share」入口；隐私选项默认值按州法不同。缺入口 → severity 3 |
| 排版 | 中文不用斜体表示强调；正文行高偏大（≥1.5），中文最小字号更高（移动端 < 12px 报 hierarchy/accessibility）；中英混排要留空格 | 斜体是可以接受的强调方式；字号阈值按 WCAG 1.4.4 缩放能力判定，不设固定下限 |
| 页脚与资质 | 境内上线的 Web 页面应展示 ICP 备案号，缺失报 `content` severity 2（final 阶段才报） | 无对应项 |

`jurisdiction` 缺省按 `locale` 推（zh-CN → CN，en-US → US）；`both` 会同时跑两列。

## 9. 依赖（能力分类，ADR-120，UNVERIFIED@baseline）
- **conditional**：`design.read`（读原型快照与 `DesignTokens`）——proposed-unwired，分类目录里没有登记，读端口也没有。
- **conditional**：`knowledge.read`（读 `prdRef` / `personaRef` / 图片资产）。
- **optional**：`sandbox.exec`，经 `apps/skill-sandbox`（基线目录存在）运行 `scripts/contrast.mjs`、`scripts/salience.mjs`（两个脚本都是 proposed-unwired）。
- **不依赖**：浏览器截图。服务端没有浏览器——这是基线 `prototype-quality.ts` 头注里的原话，所以响应式检查（375 / 768 / 1280）在 S075 里一律写进 `unmeasured`，不做估算。
- `figma-url`：没有 Figma 连接器，返回 `UNSUPPORTED_ARTIFACT`。

## 10. 决策
- **决策 1：严重度用 NN/g 的 0–4 档，按阶段设门槛，不用三色 emoji。**
  - 门槛表：`exploration` 只报 ≥3；`refinement` 报 ≥2；`final` 报 ≥1。0 档（不是问题）永远不进 `findings`。
  - 例外：WCAG A/AA 级违反在 `final` 阶段一律 ≥3；在 `exploration` 阶段按 2 档处理，放进 deferred。
  - 理由：kwp 上游只说「Match the stage」，没有给可执行的规则。三档 emoji 没法做阈值过滤，eval 也没法判定。
- **决策 2：对比度等可测指标只在拿到确切值时才标 measured；截图一律 unmeasured。**
  - 截图经过压缩、抗锯齿和色彩空间转换，像素估出来的比值在 4.5 附近误差足以翻转结论。编一个 `4.3:1` 比说「没测」更糟。
  - 原型模式有节点样式和 token，才能算出确切值。
- **决策 3：S075 只评不改，不产出 patch。**
  - 基线里设计工作台已经有 patch 写回（`patch-prototype.ts`）和变体（`design-variants.ts`，头注写明「没有兜底方案」）。修改走那两条路，由人来挑。
  - S075 如果自己改，就等于评审者给自己的修改打分；awesome-copilot 上游的「发现 + 修复」合一流程因此不采用。
  - `suggestion` 只写一句方向。
- **决策 4：不另造页面总分，结构分原样引用 `prototype-quality.ts`。**
  - 基线头注已经明确「截图审计门」和「结构自审」是两种事实，要分开命名。S075 再造第三个分数，就违反了仓库「同一事实不得声明在两处」的硬约束。
  - S075 的输出是一组带锚点的 finding，不是分数。
- **决策 5：用户感受类判断不算 finding，只能进 `hypothesesForResearch`。**
  - 评审者没有看到真实用户。「用户会困惑」是假设，要交给 S009 或可用性测试去验证。
  - 这样 D003 在 W031 Experiment Loop 之前可以拿到一张待验证清单，而不是一份被当成结论的意见。
- **决策 6：两个角色共用一份 Skill，只用 `critiqueLens` 调整走查顺序和 `impact` 的写法，不改严重度规则。**
  - D003 的 `product-fit` 会把 `impact` 对到 PRD 验收标准；D011 的 `human-centered` 会把 `impact` 对到 persona 和旅程阶段。
  - 同一处问题在两种 lens 下的 severity 必须一致（eval E8 专门检查这一点）。

## 11. 失败模式（S075 特有）
| # | 失败 | 防线 |
|---|---|---|
| F1 | 从截图「目测」出对比度数值 | O1 + 决策 2，grader 检查 |
| F2 | finding 指向不存在的节点（模型幻觉出的 nodeId） | O2 遍历校验，失败返回 `ANCHOR_UNRESOLVED` |
| F3 | 探索阶段报一堆 1 档像素问题，把方向性问题淹没 | 决策 1 门槛 + O3 |
| F4 | 把品牌色本身当成「违反设计系统」（token 里设了 brand） | M5 以项目 `DesignTokens` 为准，不以默认主题为准；圆角同理，期望值取 `RADIUS_BY_SCALE[tokens.radius]` 而不是 `default` 档的 `RADIUS` |
| F5 | 「用户会觉得很乱」写成 finding | O4 |
| F6 | 顺手给出整页重设计方案，越权成为设计者 | 决策 3；`suggestion` ≤ 1 句 |
| F7 | 同一问题在 D003 和 D011 下严重度不同 | 决策 6 + E8 |
| F8 | 忽略 CN 场景的单独同意 / 备案号 | §8，`jurisdiction` 推导 |
| F9 | 对无权读取的项目返回「无权」，泄露项目存在 | §7 统一返回 `ARTIFACT_NOT_FOUND` |
| F10 | 没写优点，或写了空泛的优点 | `strengths` ≥1 且必须有锚点 |

## 12. 评测（`evals/work-stack/S075/`，ADR-119；夹具都是合成数据）
| # | 输入 | 通过判据 |
|---|---|---|
| E1 | wx-prototype，`stage=final`；主 CTA 用 `brand=#9AA0A6`，白底文字，节点样式确切 | 出现 `WCAG-1.4.3` finding，`evidenceKind=measured`，`measurement.value≈2.6`（±0.1）、`threshold=4.5`，severity ≥3 |
| E2 | 与 E1 相同的界面，但输入是截图（`kind=image`） | **没有** measured 的对比度 finding；`unmeasured` 里有 `contrast`；不能出现任何比值数字 |
| E3 | 同一原型，`stage=exploration`，有 3 个 1 档间距问题和 1 个「主任务没有入口」的 4 档问题 | `findings` 里只有那 1 条 4 档；3 条 1 档都在 `deferred`；两者合起来是全集 |
| E4 | 输出里含有一个不在原型树里的 `nodeId: "n-999"`（注入模型输出） | 返回 `ANCHOR_UNRESOLVED`，不返回报告 |
| E5 | `critiqueLens` 省略，调用角色是 D011，`personaRef` 指向「首次使用的门店店长」 | `impact` 字段引用旅程阶段；「店长会觉得很复杂」只出现在 `hypothesesForResearch` |
| E6 | `jurisdiction=CN`，注册页用一个勾选框同时同意「用户协议 + 向合作方提供手机号」 | 出现 `CN-PIPL-separate-consent`，severity 4；同一页面在 `jurisdiction=US` 下**不**出现该项 |
| E7 | 项目 `DesignTokens.radius="sharp"`（合法枚举值）；5 个卡片节点 `radius="lg"`，其中 3 个渲染类为 `rounded-none`，2 个被手工覆盖成 `rounded-card` | 期望类 = `RADIUS_BY_SCALE.sharp.lg = "rounded-none"`；报 `design-system:radius` 的 consistency finding 并锚定那 2 个节点；**不**把 `rounded-none` 的卡片报成问题 |
| E7b | 夹具 `DesignTokens.radius="none"` | `DesignTokens.parse` 抛错（非法枚举，且 `.strict()`）；S075 不产出圆角 finding，只报输入不合法，不回退到默认档 |
| E8 | 同一原型分别用 `product-fit` 和 `human-centered` 跑 | 两份报告的 `findingId` 集合与每条 severity 完全一致，只有 `impact` 文本不同 |
| E9 | 调用者不属于该项目所在组织，传入一个真实存在的 `projectId` | 返回 `ARTIFACT_NOT_FOUND`，与传入不存在的 id 时字节级一致（不含时间戳） |
| E10 | `kind=description`，文本为「一个普通的登录页」 | 返回 `DESCRIPTION_TOO_THIN` |
| E11 | 原型模式下能拿到 `QualityDeduction`，其中 `hierarchy` 为 0.75，hint 是「字号只有两档」 | `structuralSignals` 原样包含这一项；报告里没有任何总分字段；如果另有 hierarchy finding，它要锚定到具体节点 |
| E12 | `kind=figma-url` | 返回 `UNSUPPORTED_ARTIFACT`，不去抓取 URL |
| E13 | zh-CN 移动端，正文 11px、斜体强调 | 报 hierarchy/accessibility（11px < 12px）以及 content（中文斜体），`final` 阶段 ≥2 |

## 13. WorkspaceX 落位
已在基线上核实：
- `apps/api/src/application/design-workbench/`：`prototype-quality.ts`（`QualityDeduction`）、`design-comments.ts`（nodeId/frameIndex 批注）、`design-variants.ts`、`patch-prototype.ts`、`project-shared.ts`
- `packages/contracts/src/design-workbench.ts:322`（`DesignTokens`）
- `apps/api/migrations/20260923160000_design_project_tokens.sql`
- `.harness/rubrics/prototype-screenshot-audit.md`
- `apps/skill-sandbox/`
- `skills/standard-methods/`（已有 `interview-synthesis` 等包）

待新建（proposed-unwired）：
- `skills/standard-methods/design-critique/SKILL.md`，以及 `scripts/contrast.mjs`、`scripts/salience.mjs`、`references/upstream.md`
- design-workbench 面向 Skill 的只读端口（§7）
- `evals/work-stack/S075/`

## 14. Graph change proposals（只提议，不改矩阵）
- **提议 1**：在 W029 Problem-to-PRD（矩阵第 35 行）的 S067/S068 之后加入 S075。PRD 附原型时，可以在进入 W030 前做一次 `refinement` 评审。目前 S075 没有任何 Workflow 消费者，所以 D003 / D011 在 Workflow 内都用不到它。
- **提议 2**：评估 D043 UX Researcher（矩阵里 S075 不在其 Skill 列）是否需要直接挂载 S075。本文**不假定**这条边存在。

## 15. 未决问题
- §8 CN 列里 GB/T 37668 与适老化文件的具体条款号，需要方法评审人核对（UNVERIFIED）。
- `design.read` 分类名和 design-workbench 的只读端口要由 ADR-120 目录 owner 和设计工作台 owner 确认。
- 一键把 findings 落成设计批注（§7）要不要做：如果做，那是 D003/D011 发起的写操作，需要单独走 HITL `ask`，不属于 S075。
