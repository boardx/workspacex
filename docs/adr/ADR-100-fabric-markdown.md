# ADR-100: fabric-markdown 源码并入与版本锁定

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-07-30
- 作者：w0-canvas（worker）
- 关联：F100（phase-01，issue #50）· 裁决 D-08 / O-09 · 契约束 `canvas` 的 `domain.md` 第〇节（D-g「F100 的 ADR 编号 未分配」由本文闭合）· ADR-019（编号取号）

## 背景

`07-canvas` 的四份 UC（uc-7.1 ~ uc-7.4）共用一条数据链：

```
Markdown ⇄ mermaid 文本 ⇄ DiagramModel ⇄ Fabric 画布对象
```

D-08 已拍板：交换格式 mermaid、渲染层 fabric.js、**指定复用既有库 `fabric-markdown`**
（本机 `projects/fabric-markdown`，`v0.1.0`，13 种 mermaid 图 + 19 个《工作坊模板 A0》
画布模板 + 一整套单测）。O-09 进一步拍板了两件事：**以源码并入 `packages/`**（不是 npm 依赖），
以及**不改 key、加 `display_name`**。

`domain.md` 第〇节把 F100 单列为例外，理由是它「约束的不是 API 形状，是第三方源码引入」：
zod 写得了 `key: enum(19)`，写不了「这 19 个 key 一个都不许改」。那条约束的落点就是本 ADR，
且 `domain.md` 明确写着「在 ADR 落地之前，I-24 ~ I-27 四条断言无处可锚」。

真正的风险不在「选哪个库」，在**上游 API 的弃用**：库的 mermaid 解析取自 mermaid
**已弃用**的 `getDiagramFromText`。主版本一跳，整条数据链断，而**不会有任何类型错误提示**——
它会在现场工作坊切环节的那一秒才显形。

## 决策

### 一、并入形态：源码并入 `packages/fabric-markdown`，本仓从此是它的 owner

- 上游 `src/` 与 `tests/` **逐字并入**，不改任何 `key`、不改任何既有测试。
- 新增本仓专属的四个文件，**都不改上游语义**：
  `package.json`（`@repo/fabric-markdown`，workspace 私有包）· `tsconfig.json` ·
  `vitest.config.ts` · `src/templates-entry.ts`（见决策三）。
- 上游的 `demo/`、`dist/`、`vite.config.ts`（含库打包配置）**不并入**——
  本仓通过 workspace 源码直连消费（`main: ./src/index.ts`，与 `@repo/contracts` 同款），
  没有产物构建这一层，也就没有它带来的版本漂移面。
- **理由**：需要在本仓语义上扩展模板元数据（`agenda_segment` 绑定、可见性、使用计数），
  npm 依赖承接不了；而一旦要改，「等上游发版」这条路就不存在了——所以必须先承认 ownership。

### 二、版本锁定：`fabric` 与 `mermaid` 锁到**确切版本**，不是 caret

上游 `package.json` 写的是 `fabric: ^7.4.0` / `mermaid: ^11.16.0`。
本仓改为**确切版本**：

| 依赖 | 上游 | 本仓锁定 | 为什么 |
|---|---|---|---|
| `mermaid` | `^11.16.0` | `11.16.0` | 解析路径依赖**已弃用**的 `getDiagramFromText`。caret 允许次版本自动升，而弃用 API 通常在次版本里先变行为、后删除，**全程无类型错误** |
| `fabric` | `^7.4.0` | `7.4.0` | v7 的 center-origin 约定是整套坐标/归区判定的前提；一次次版本的默认值变更就能让 34 个序列化回归防护全部失真 |

**这不是保守，是把「无声失败」换成「装不上」**：锁死之后升级必须是一次显式的、
带测试证据的动作，而不是某次 `pnpm install` 的副作用。

### 三、降级路径：纯函数层必须能脱离浏览器运行

mermaid 解析需要真实浏览器（依赖 `getBBox` 做文本测量），但**模板注册表、Markdown
提取/替换、mermaid 序列化、归区判定是纯函数**。本仓据此新增
`src/templates-entry.ts`：一个**只激活 19 个 A0 模板、完全不触碰 `fabric` / `mermaid`** 的入口。

- 后端契约测试（F100 的两条 verification）走这个入口，在 Node 里跑，不需要 jsdom、
  不需要 fabric 能加载。
- 并入的 222 个上游单测仍在 `packages/fabric-markdown` 内以 jsdom 跑。
- **纯 SVG 解析降级路径**（R10 要求的「上游弃用 API 的唯一逃生口」）：上游
  `mermaid-parser.ts` 的 `extractNodeGeometry` 已从渲染出的 SVG 读取节点几何，
  它是 `getDiagramFromText` 之外的第二条信息通路。本 ADR **记录它的存在与它是逃生口**，
  但**不声称它今天已经是一条可切换的完整降级链**——见「没做到的部分」。

### 四、19 个 `key` 冻结，`displayName` 单点在契约层

- **`key` 的唯一权威是库源码**里的 `registerTemplate({ key: ... })`。一个都不许改。
- **`displayName` 的唯一权威是 `packages/contracts/src/canvas.ts` 的
  `BUILTIN_CANVAS_TEMPLATES`**，**不回灌进库源码**。
- 两者由 F100 的**集合相等断言**绑死（I-2 / I-36）：
  `apps/api/tests/canvas/template-registry-19-key-displayname.test.ts`。
  断言逐 key 点名差集，**不是 `toHaveLength(19)`**——长度断言会挡住正当的新增，
  且换成另外 19 个 key 照样绿。另有一条测试证明该断言**在两边都空时会抛**（不平凡为真）。
- 一切绑定 / 实例固化 / 围栏语法 / 图谱回流引用 `key`（I-3），由
  `apps/api/tests/canvas/binding-uses-key-not-displayname.test.ts` 门控。

> ⚠ **与 UC R10 / `domain.md` 的一处偏离，须人类裁决**：两处都写着并入的理由是
> 「需在库内加 `display_name` 列」。本 ADR **没有**在库内加这一列，因为那会让
> 五处 key≠displayName 的差异同时存在于库源码与契约文件两个地方，
> 直撞 AGENTS.md 的「同一事实不得声明在两处」（本项目已五次因此漂移）。
> 取舍是：**displayName 只在契约层声明，库只管 key**。
> 若人类认为库内必须有该列，则须同时指定哪一份是权威、另一份如何机械派生。

### 五、上游改动的回流方式

- **本仓是 owner，回流方向是「上游 → 本仓」的单向 cherry-pick**，没有反向 PR 义务。
- 并入基线记录在 `packages/fabric-markdown/VENDOR.md`（上游路径 + 版本 + 并入日期 +
  本仓改动清单）。上游有新提交时，比对基线、按文件挑，**挑完必须跑完整并入测试套件**。
- **任何回流都不得改动 19 个 `key`**；改了 key 的上游提交一律拒收，或改名后本仓保留旧 key 别名。

## 后果

**正面**

- 数据链的三段（Markdown / mermaid / DiagramModel）全部在本仓可读、可改、可打断点。
- 版本锁把「上游弃用 API 的无声漂移」变成一次显式升级动作。
- 19 个 key 有了机械门控；此前它只是一份表格。

**负面（照实说）**

- **安全更新从此是本仓的责任**：`fabric` / `mermaid` 的补丁不会自己进来，需要人主动升 + 跑测试。
  确切版本锁把这个成本摆到明处，但它没有消失。
- **222 个上游单测进了本仓的 CI**，`packages/fabric-markdown` 的 `test` 需要 jsdom，
  整包测试约 1 分钟。这是并入的固定开销。
- **上游演进与本仓演进从此分叉**，且分叉点只由 `VENDOR.md` 一份文本记录——
  它没有脚本门控，属于本 ADR 已知的薄弱环节。

**没做到的部分**

- **「纯 SVG 解析降级路径」今天不是一条可切换的完整链路**。R10 要求「保留纯 SVG 解析降级路径」，
  库里存在 SVG 几何提取（`extractNodeGeometry`），但**没有**「`getDiagramFromText` 不可用时
  自动改走纯 SVG」的开关，也没有对应测试。本 ADR 只锁版本、只记录逃生口的位置，
  **不声称降级已实现**——那需要一个独立 feature。
- **`packages/fabric-markdown` 的源码未按本仓 coding-standards 改写**（命名、注释语言、
  文件规模均沿上游）。这是刻意的：改写会让上游回流的 diff 失效。代价是这一包在风格门控上是例外。

## 我们什么情况下会改主意

- mermaid 提供了 `getDiagramFromText` 的**受支持替代 API** ⇒ 迁移过去，主版本锁可放松到 caret。
- 本仓对该库的改动收敛到零、且上游接受我们的扩展 ⇒ 可退回 npm 依赖（但 key 冻结约束仍需保留）。
- 画布渲染层换掉 fabric.js ⇒ 本 ADR 的第二、三条整段作废，需另开 ADR 记录迁移。
