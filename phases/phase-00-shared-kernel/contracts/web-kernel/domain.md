# 契约束 `web-kernel` — ① 领域模型与不变量

> 洋葱最内层。**但这个束没有后端领域**——它是**前端内核**。
> 覆盖 feature：**F14**（phase-00，13 点，唯一已落地的 feature）
> 依据：`uc-0-4 前端内核与设计单源`
> 裁决：ADR-003（UI 先行 sign-off 关卡）· D-35（testid 命名规范）· D-36（七态统一规范）·
> ADR-013（字号档位单一事实源）· UC-0.3 R8（两层身份条）· O-12（组织切换器）

---

## 零、这个束为什么和另外三束不一样

`identity` / `artifact` / `context-pack` 的领域模型是**会落库的业务数据**（组织、原件、
Context Pack）。它们的不变量是「数据损坏」意义上的不变量。

`web-kernel` **不落任何库、不写任何后端逻辑、不产生任何权限判定**（UC-0.4 R1「核心数据对象：
无业务数据对象」）。它的「领域」是**前端内核的结构性契约**：

- **设计 token** 的配对与对比度
- **字号档位** 的单一事实源
- **七态** 的固定保留名与互斥
- **testid** 的命名规则
- **预览开关** 在生产的不可达性

所以这个束的「不变量」不是「违反即数据损坏」，而是「**违反即设计漂移 / 前端隐藏被误当权限 /
异常态漏做**」——每一条都仍然**能写成机械断言**，而且**每一条都已经有一道在跑的门控**
（F14 是唯一代码已落地的 feature）。这个束的四件套是**把既成事实固定成契约并证明覆盖**，
不是设计新东西。

---

## 一、值对象（前端内核的结构单位）

### `DesignToken`（值对象）—— 单一事实源：`apps/web/app/globals.css`

| 概念 | 说明 |
|---|---|
| 色面 token | HSL 语义变量 `--x`，仅在 `globals.css` 的 `:root`（明）与 `.dark`（暗）两个块内定义 |
| 配对 foreground | 每个标注 `@contrast neutral \| state` 的 `--x` **必须**有 `--x-foreground` |
| `@contrast` 分组 | `neutral`（正文可读线 ≥4.5:1）/ `state`（大字·UI 组件线 ≥3.0:1）/ `none`（纯结构，不承载文字，不参与配对） |

⚠ **对比度只能通过改 `globals.css` 的 token 值来满足，严禁在组件层用 opacity 或覆盖类「修」**
（UC-0.4 E1 / R7）。原因：组件层的修补让对比度**不可静态验证**。

### `FontScaleStep`（值对象）—— 单一事实源：`apps/web/lib/font-scale.ts`

`FONT_SCALE` 是全仓**唯一**允许定义字号档位的地方。`key` = 名义 px（类名 `text-<key>`），
`value` = `[size, { lineHeight, letterSpacing? }]`。
`tailwind.config.ts` 与 `lib/utils.ts` **一律 import 它**（`FONT_SCALE` / `FONT_SCALE_KEYS`），
不得手写第二份档位清单。

> 依据 uiux-standards §1.2 的真实事故：字号表曾有三份副本靠人肉对齐，修了两份、第三份
> 24 小时后复发（`text-12` 被 tailwind-merge 当颜色类吞掉，造「黑底黑字」）。**新增字号 = 只改本文件一处。**

### `UiState` 七态（值对象）—— 单一事实源：`apps/web/lib/ui-state.ts`

`UI_STATES` = `["default","loading","empty","invalid","dep-failed","denied","success"]`，**恒为七个**（D-36）。
`resolvePreviewState()` 在 `NODE_ENV=production` 时**恒返回 `default`**（预览开关不可达）。

**状态 → 固定保留 testid 的映射**（D-35 保留名）：

| UiState | 固定保留 testid | 说明 |
|---|---|---|
| `default` | 屏自身内容（无保留名） | 正常内容 |
| `loading` | `loading` | |
| `empty` | `empty` | |
| `invalid` | `err-<字段>`（如 `err-email`） | 字段级校验失败 |
| `dep-failed` | `dep-failed` | 依赖失败态 |
| `denied` | `denied` | 无权限态（**不是空列表**） |
| `success` | `saved` | 成功态 |

⚠ **保留 testid 的契约是「屏处于该态时保留名可被选中」，与降级粒度无关。**
`/tasks` 做的是分区级降级（③ 区失败其余三区照常），它**仍必须挂 `dep-failed` 保留名**——
否则该屏在七态矩阵里被判为漏做异常态，而「漏做异常态」正是既有静态原型最大的缺陷。

### `TestId`（值对象）—— 命名规则单一事实源：`uiux-standards.md`，执行者：`lint-design.sh`

结构 `<域>-<对象>-<角色>`，全小写 kebab-case，正则 `^[a-z0-9]+(-[a-z0-9]+)*$`
（如 `files-tree-node`、`itv-transcript-seg`）。**禁止携带业务数据**（中文 / 大写 / 下划线 /
文件名如 `files-node-合同2024.pdf`），只标结构。

### `PreviewSwitch`（值对象）—— 生产不可达

`?state=<七态>`（状态预览）、`?as=<四角色>`（视角预览）、`?org=<组织>`（组织预览）**只在
开发/预览环境生效**。生产构建下三者**均不改变渲染结果**（UC-0.4 R9 / V8）。
⚠ **视角切换是预览手段，不是权限实现**（R5）：它只改本地展示，不改服务端返回的数据。
让它在生产可达，等于给了一个「自称是引导师」的前端开关。

---

## 二、不变量

> 判据放宽为：**它在任何时刻都为真，违反即设计漂移 / 安全错觉 / 异常态缺失**。
> 每条都能写成断言，且**每条都已有一道在跑的门控**（右列）。

| # | 不变量 | 断言方式（既有门控） |
|---|---|---|
| **I-1** | 每个标注 `@contrast neutral\|state` 的色面 token `--x` **必有**配对 `--x-foreground` | `check-token-contrast.mjs` 解析 `globals.css`，缺对 exit 1 |
| **I-2** | neutral 对 ≥ 4.5:1、state 对 ≥ 3.0:1，**明暗两套主题各自成立** | 同上，逐对打印实测比值（有输出，非静默通过） |
| **I-3** | 全仓任何 `text-<n>` 的 `n` **必属** `FONT_SCALE_KEYS`（字号档位副本数 = 1） | `lint-design.sh` §1.2 白名单从 `font-scale.ts` 动态读，表外 exit 1 |
| **I-4** | `tailwind.config.ts` 与 `lib/utils.ts` **不含字面量档位清单**，均从 `font-scale.ts` 取值 | `lint-design.sh` 正则 + `single-source-of-truth.test.ts` |
| **I-5** | `UI_STATES` **恒为七个**且顺序固定；`resolvePreviewState` 生产恒 `default` | `ui-state.ts` 单源；`single-source-of-truth`/`verify-prod-gates` |
| **I-6** | 任一屏处于某异常态时，其**固定保留 testid** 出现在 SSR 出的 HTML 里（与降级粒度无关） | `verify-ui-states.sh` 全屏 × 6 态矩阵 |
| **I-7** | 七态**互斥**：切到 A 态时 B 态的保留 testid 不得同现 | `verify-ui-states.sh` 互斥段 |
| **I-8** | 所有 `data-testid` 匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`，且不含业务数据（中文/大写/下划线） | `lint-design.sh` D-35 |
| **I-9** | 预览开关 `?state=` / `?as=` / `?org=` 在**生产构建**下不改变渲染结果 | `verify-prod-gates.sh` |
| **I-10** | 项目层身份**只在项目上下文**渲染；非项目页不得出现 `role-bar-project` / `role-preview-switcher` / `topbar-project-context` | `verify-ui-states.sh` 反向段（这是 identity I-11 的界面投影） |
| **I-11** | 本地组织的「只走本地」是**产品承诺**（`data-guarantee-source="promise"`），正式组织的 self-hosted-only 是**策略**（`policy`），二者**可分辨** | `verify-ui-states.sh` `assert_guarantee`（这是 identity I-10 的界面投影） |

### 为什么 I-10 / I-11 出现在这个束

它们的**判定**属 `identity`（服务端不变量 I-11 / I-10），但它们的**界面投影**属这里——
前端内核负责「把两层身份、把承诺 vs 策略**渲染成人能看见且机器能断言的东西**」。
⚠ 这两条是**跨束界面投影**，签核时须与 identity 束对齐（见 coverage.md 缺口）。

### 为什么这个束的不变量不写成「违反即数据损坏」

它不碰数据。但「设计漂移」在本项目是**已发生五次**的高发失效模式，「前端隐藏被误当权限」
是 UC-0.3 R5 明令禁止的安全错觉，「异常态漏做」是既有原型最大的缺陷。
把它们钉成机械断言，价值等同于业务束的数据不变量。

---

## 三、③ 件为什么**不是** zod 契约文件（本束最重要的判断）

另外三束的第 ③ 件是 `packages/contracts/src/<bundle>.ts` 的 zod schema。
**这个束不产出 zod 契约文件。** 理由如下，逐条成立：

1. **ADR-020 的 zod 单源是为了生成四样下游产物**——后端 DTO + 前端 client 类型 +
   OpenAPI + **前端 mock**。`web-kernel` **零后端、零 HTTP、零 mock 生成、零 OpenAPI**：
   四个下游消费者**一个都不存在**。为不存在的消费者造单源是空转。

2. **这个束的每一条契约都已有一份非 TS 的机械单源**，且那份单源**必须是那个形态**：
   - 设计 token → `globals.css`（值必须是 CSS 自定义属性，浏览器才读得到）
   - 字号档位 → `lib/font-scale.ts`（已是 TS 单源，已被 tailwind/utils/lint 消费）
   - 七态集合 → `lib/ui-state.ts` 的 `UI_STATES`
   - testid 命名 → `lint-design.sh` 的正则 + `uiux-standards.md`
   - 预览开关不可达 → `verify-prod-gates.sh`

3. **再造一个 `web-kernel.ts` 把七态枚举/保留名/阈值搬进去，会制造第二份声明**——
   因为真正的执行者是 **bash 门控、CSS、tailwind 配置**，它们**无法 import zod schema**。
   于是要么 zod 是死副本、要么两处并存漂移。这正是 `contract-design.md` 硬规则 3
   （「不许在两处声明同一事实」）和 ADR-020 反复警告的第六次漂移。

4. **`lint-contract-source.mjs` 门控的前提是「契约在 zod、mock 从契约生成」**。本束没有
   mock、没有生成物，把它塞进那道门控只会让门控空跑。

⇒ **结论：`web-kernel` 的第 ③ 件就是既有的门控脚本本身**（它们是契约的可执行形式），
不新增 `packages/contracts/src/web-kernel.ts`。coverage.md 的「API 操作」列因此填**门控命令**，
「前端消费点」列填**被验证的路由 / testid**。

> 反面自检：如果哪天出现「多个 TS 消费者（vitest + 组件代码）都需要那份七态/保留名清单」，
> 正确的收敛**不是** zod，而是把它做成 `lib/` 里一个**纯 TS 常量单源**，并让 bash 门控像
> 读 `font-scale.ts` 那样 `sed` 读它（见下节缺口 G-1）。zod 在这个束里始终是错误的工具。

---

## 四、这个域不负责什么

- **任何业务屏**（文件浏览器、蓝本设计器、访谈现场屏）——属各自 UC，不在本件（R6）。
- **任何后端逻辑与权限判定**——权限一律在服务端（`identity` 束 / UC-0.3）。
  本束只做**界面投影与预览外壳**。
- **响应式的具体断点实现**——375/768/1280 的无横向溢出约束存在（R9 / V9），
  但**当前没有自动化覆盖**（见 coverage.md 缺口 G-2 / V9）。
