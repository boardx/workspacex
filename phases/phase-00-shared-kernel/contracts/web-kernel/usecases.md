# 契约束 `web-kernel` — ② 用例接口（前端内核的对外面）

> 洋葱中层。**但这个束没有 application service**——它是前端内核。
> 所以「用例」在这里是**内核对外暴露的两类面**：
>   1. **门控面**：`apps/web/scripts/*` 与 `tests/*`——契约的**可执行形式**。它们是本束的「③ 件」。
>   2. **渲染面**：内核外壳组件（`StateShell` / 应用外壳 / 预览开关）对屏幕的**渲染契约**。
>
> ⚠ **失败模式仍要穷举**——但这个束的「失败」不是 HTTP 错误码，而是
> **门控在什么输入下必须 exit 1**。只验「脚本能跑」不验「脚本能抓到违规」等于没有门控（R12 V5）。

---

## 一、门控面（契约的可执行形式）

每条门控 = 一条不变量的执行者。**输入**是被扫描的代码/CSS/路由，**输出**是退出码 + 逐条报告。

### `check-token-contrast` —— 设计 token 配对与对比度（I-1 / I-2）

```
in:  apps/web/app/globals.css（唯一输入，不维护第二份色板）
out: 每个 token 对的实测比值（明暗两套主题各打印一遍）+ 退出码
pass: 每个 @contrast neutral/state 的 --x 都有 --x-foreground；neutral≥4.5、state≥3.0，两套主题
fail(exit 1):
  · 某色面 token 缺配对 foreground
  · 某对不过对比度线
  · 找不到 :root 或 .dark 块
  · 没有任何被标注的色面 token（防「脚本在，但什么都没扫」）
```

⚠ **失败的唯一修法是回 `globals.css` 改 token 值**（E1）。严禁组件层 opacity/覆盖类「修」。

### `lint-design` —— 设计规范 U1–U8 + 字号单源 + testid 命名（I-3 / I-4 / I-8）

```
in:  app / components / lib 下的 *.tsx *.ts（可显式指定 __fixtures__ 定向扫描）
out: 逐条违规（文件:行号）+ 违规总数 + 退出码
pass: 无违规
fail(exit 1) 的每一类都必须被单独报出：
  U5a 硬编码颜色 · U5b 任意值像素间距 · U1.1 disabled:opacity · U1.2 opacity 表状态 ·
  U6 裸 <input>/<select>/<button> · U4 hover 无 transition · U7a img 缺 alt ·
  U7b outline-none 无 focus-visible:ring · §1.2 表外字号档位 · §1.2 字号清单第二份副本 ·
  MD JSX 残留 Markdown 加粗 · D-35 testid 携带业务数据
```

⚠ **字号白名单从 `lib/font-scale.ts` 动态 `sed` 取，脚本内不手抄第二份清单**——
这是「单源被门控消费」的正确形态，也是本束若需共享 TS 常量时该效仿的模式（domain 缺口 G-1）。

### `lint-design-gate`（vitest）—— **门控自身的测试**（R12 V5，本件最重要的一条验收）

```
in:  __fixtures__/lint-bad.tsx（含每一类故意违规）、__fixtures__/lint-good.tsx（合规）
out: 断言 bad → exit 1 且报出全部 12 类；good → exit 0
why: 只验「脚本能跑」不验「脚本能抓到违规」= 没有门控。这条把「门控有效」本身钉成断言。
```

### `single-source-of-truth`（vitest）—— 字号 / token 单源（I-4）

```
断言：tailwind.config.ts import FONT_SCALE 且无字面量 fontSize 对象；
      lib/utils.ts 用 FONT_SCALE_KEYS 且无手抄数字串；
      globals.css 明暗两套主题齐备、每个被标注色面 token 有配对 foreground。
```

⚠ **已知第二份副本**：本测试内 `structural = new Set(["border","border-subtle","input","ring"])`
硬编码了「哪些 token 豁免配对」，而 `globals.css` 里同一事实用 `@contrast none` 标注——
**同一豁免清单声明在两处**（见 coverage.md 缺口 G-3）。

### `verify-ui-states` —— 七态可达 + 互斥 + 两层身份投影 + 承诺可分辨（I-5/I-6/I-7/I-10/I-11）

```
in:  自带 dev 实例（独立端口 + 独立 distDir，可与常驻 dev 并存）
out: 逐屏逐态 SSR HTML 里保留 testid 是否可选中 + 退出码
断言：
  · 七态各有固定 testid，且互斥
  · 全屏 × 6 异常态矩阵：18 屏 × {loading,empty,invalid,dep-failed,denied,success} 保留名可选中
  · 项目页有两层身份条；非项目页只有组织层（role-bar-project 等不得泄漏）
  · assert_guarantee：本地=promise / 正式 self-hosted=policy / 无限制=none 可分辨
fail(exit 1): 任一保留 testid 缺失 / 互斥破坏 / 项目层泄漏到非项目页 / 承诺与策略不可分辨
```

⚠ **屏清单 `SCREENS` 是脚本内手维护的**——新增屏若忘记加进去，静默逃出矩阵（缺口 G-4）。

### `verify-prod-gates` —— 预览开关生产不可达（I-9）

```
in:  next build 的生产构建 + next start 实例
断言（在生产构建下）：
  · state-preview-switcher / role-preview-switcher 不渲染
  · ?state=empty 不生效，回落 default
  · ?as=observer 不改变角色投影
fail(exit 1): 任一预览开关泄漏到生产
```

### `turbo typecheck/lint/test`（骨架完整，I 覆盖 V1）

```
断言：pnpm --filter web run {typecheck,lint,test} 退出码 0；apps/web 被 turbo --affected 命中。
```

---

## 二、渲染面（内核外壳对屏幕的渲染契约）

这些不是命令，是**组件的输出契约**——门控面就是在验它们。

### `StateShell` —— 七态统一外壳（D-36「统一规范」的载体）

```
props: { state: UiState, ... }
渲染契约：
  state=loading    → 挂 data-testid="loading"
  state=empty      → 挂 data-testid="empty"
  state=invalid    → 挂 data-testid="err-<字段>"
  state=dep-failed → 挂 data-testid="dep-failed"
  state=denied     → 挂 data-testid="denied"（**不是空列表**——无权限≠无数据）
  state=success    → 挂 data-testid="saved"
  state=default    → 屏自身内容
不变量：同一时刻只渲染一态（I-7 互斥）；分区级降级也必须挂对应保留名（I-6）。
```

### 应用外壳 —— 三栏骨架 + 组织切换器 + 两层身份条（O-12 / UC-0.3 R8）

```
渲染契约（骨架固定 testid）：
  app-shell / shell-rail / shell-topbar / shell-main / shell-left-panel /
  shell-right-panel / shell-ambient / org-switcher / role-bar-org
项目上下文时额外：role-bar-project / topbar-project-context
两层身份条形如「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」。
组织切换（O-12）：切换后团队归属随之改变（远洋→能源组 / 恒泰→供应链组）。
⚠ 顶栏此刻只有界面与本地 mock，不接后端；真实权限在服务端（identity 束）。
```

### 预览开关 —— `resolvePreviewState` / `?as` / `?org`

```
契约：三者仅开发/预览生效；resolvePreviewState 在 NODE_ENV=production 恒返回 default。
⚠ 视角切换只改本地展示，不改服务端数据（R5）——代码与文案都须标明「不是权限」。
```

---

## 三、端口（这个束没有 infrastructure 端口）

`identity`/`artifact`/`context-pack` 有 Repository/Writer 等端口给 `infrastructure` 实现。
**`web-kernel` 没有**——它不落库、不出网、无持久化依赖。它唯一的「外部依赖」是
`next build` / `next dev`（构建工具链）与浏览器渲染，二者由门控脚本自带实例托管。

⚠ **门控脚本不可执行时 verify 判失败，不得静默降级为跳过**（R9 / UC-0.4 R6 失败后置条件）。
