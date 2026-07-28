# 契约束 `web-kernel` — ④ UC 覆盖证明

> **这一件回答的问题**：前面两件定的门控与渲染契约，**真的覆盖住 UC-0.4 的验收线索吗？**
>
> 覆盖 feature：**F14**（13 点）
> 验收线索来源：`uc-0-4` 的 R12 共 **V1–V10 十条**
>
> ⚠ 这个束**没有 HTTP API**（见 domain.md 第三节）。所以下表的
> **「门控命令」列填被验证的可执行门控**（而非 API 操作），
> **「前端消费点」列填被验证的路由 / 固定 testid**。
> 这正是 contract-design.md 对本束特殊处理的要求。

## 怎么读这张表

**两个方向都要查**：

- **UC → 门控**：某条 R12 找不到对应门控 ⇒ **验收悬空，规范未落地**（R7：没有脚本的规范条目视为未落地）
- **门控 → UC**：某道门控没有任何 R12 要它 ⇒ **门控是多余的**

---

## 一、`uc-0-4` 前端内核与设计单源（V1–V10）

| R12 | 一句话 | 门控命令（契约的可执行形式） | 前端消费点（路由 / testid） | 状态 |
|---|---|---|---|---|
| **V1** | 骨架：`pnpm dev` 起、`turbo typecheck/lint/test --filter=web` exit 0 | `pnpm --filter web run typecheck` · `pnpm --filter web run lint` · `pnpm --filter web run test` | `/kitchen-sink` `app-shell` | ✅ |
| **V2** | token 单源：明暗两套主题各打印每个 token 对的实测比值 | `node apps/web/scripts/check-token-contrast.mjs` | `app/globals.css` `:root` / `.dark` | ✅ |
| **V3** | token 反证：注入缺 foreground 的色面 token → 断言脚本 exit 1 | ⚠ **只有正向自动化**：`single-source-of-truth.test.ts` 断言每个色面 token 有配对；**「注入坏 token → exit 1」是 R12 描述的手动反证，无常驻 fixture** | `app/globals.css` | ⚠ **缺口 G-5** |
| **V4** | 字号单源：`text-<n>` 全在 `font-scale.ts`；tailwind/utils 均 import、无字面量清单 | `apps/web/scripts/lint-design.sh`（§1.2）· `single-source-of-truth.test.ts` | `lib/font-scale.ts` · `tailwind.config.ts` · `lib/utils.ts` | ✅ |
| **V5** | lint 门控双向：bad fixture exit 1 且报全部类，good fixture exit 0 | `pnpm --filter web run test`（`lint-design-gate.test.ts`，**本件最重要的验收**） | `__fixtures__/lint-bad.tsx` · `lint-good.tsx` | ✅ |
| **V6** | 七态：`?state=` 七取值各自固定 testid 可见且互斥 | `apps/web/scripts/verify-ui-states.sh`（七态 + 互斥 + 18 屏 × 6 态矩阵） | `/kitchen-sink?state=*` `loading`/`empty`/`err-email`/`dep-failed`/`denied`/`saved`/`section-states` | ✅ |
| **V7** | testid 规范：每个可交互元素带 testid；全部匹配命名正则；无业务数据 | `apps/web/scripts/lint-design.sh`（D-35）——**只查了「无业务数据」**；**「每个可交互元素都带 testid」的正向存在性未被断言**（`lint-dead-controls` 查的是控件是否活，非是否有 testid） | `lint-design.sh` D-35 | ⚠ **缺口 G-6** |
| **V8** | 生产可达性：生产构建下 `?state=` / `?as=` 不改变渲染 | `apps/web/scripts/verify-prod-gates.sh` | 生产 `/kitchen-sink` · `state-preview-switcher` / `role-preview-switcher` 缺席 | ✅ |
| **V9** | 响应式：375 / 768 / 1280 三档 `scrollWidth <= clientWidth` 无横向溢出 | `pnpm --filter web e2e`（Playwright，25 屏 × 3 档 = 75 断言） | 全部 25 条路由 | ✅ |
| **V10** | 规范同步：`uiux-standards.md` §0 的 U1–U8 每条都能在 `lint-design.sh` 或 e2e 找到对应检查 | `apps/web/scripts/lint-design.sh` 覆盖 U1/U4/U5/U6/U7；**但「U1–U8 逐条都有对应检查」这件事本身没有一道机械断言去证明**（靠人读脚本注释比对） | `lint-design.sh` · `uiux-standards.md` §0 | ⚠ **缺口 G-7** |

---

## 二、缺口清单（这一件的真正价值所在）

> 既有实现里，F14 已把 V1/V2/V4/V5/V6/V8 钉成常驻门控。下面 7 条是**「该是契约却没被固定下来」
> 或「验收线索无自动化覆盖」**的部分——四件套的意义就是在签核前把它们如实摆出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **G-1** | **七态保留名与「状态→testid」映射没有单一 TS 事实源**。保留名硬编码在 `state-shell.tsx` 的 JSX 里，又在 `verify-ui-states.sh` 里以 `case $st in invalid) want="err-" ...` 重列一遍；`lib/ui-state.ts` 只有状态名（`UI_STATES`）不含保留 testid 名 | **潜在第二份副本**（该是契约却没被固定） | 把保留名 + 映射做成 `lib/ui-state.ts` 里一个纯 TS 常量单源（如 `RESERVED_STATE_TESTIDS`），让 `verify-ui-states.sh` 像 `lint-design.sh` 读 `font-scale.ts` 那样 `sed` 读它。**不用 zod**（见 domain 第三节）。⚠ 这是最典型的第六次漂移候选 |
| ~~G-2~~ | ~~V9 响应式无自动化覆盖~~ | ✅ **已关闭（2026-07-29）** | 见下方「G-2 的关闭过程」 |
| **G-3** | **「哪些 token 豁免配对」这一豁免清单声明在两处**：`globals.css` 用 `@contrast none` 标注，`single-source-of-truth.test.ts` 又硬编码 `new Set(["border","border-subtle","input","ring"])` | **第二份副本**（该是契约却没被固定） | 让测试从 `globals.css` 的 `@contrast none` 标注动态解析豁免集，删掉硬编码 Set；单源仍是那份 CSS |
| **G-4** | **`verify-ui-states.sh` 的 `SCREENS` 屏清单是脚本内手维护的**。新增业务屏若忘记加入，静默逃出七态矩阵 | 覆盖可静默漏 | 让屏清单从路由表（`app/` 目录约定）动态派生，而非手抄。这条会随 phase-01 屏数增长而放大风险 |
| **G-5** | **V3 的反证（注入缺 foreground 的坏 token → exit 1）没有常驻 fixture**。只有正向断言「每个色面 token 有配对」 | 门控自身未被测（对照 V5 的处理） | 仿 `lint-design-gate.test.ts` 的做法，给 `check-token-contrast` 加一个坏 token fixture，断言它 exit 1。否则「对比度门控能抓到缺对」这件事本身没被验证 |
| **G-6** | **V7 的「每个可交互元素都带 testid」正向存在性未被断言**。`lint-design.sh` D-35 只查「带的 testid 合不合规」，不查「该带的有没有带」；`lint-dead-controls` 查的是控件是否活、非是否有 testid | 验收线索半覆盖 | 加一道扫描：控件标签（Button/button/a/input…）若无 `data-testid` 则报出。⚠ 需先定义「关键展示区」的边界，避免噪音 |
| **G-7** | **V10「U1–U8 逐条都有对应检查」本身没有机械证明**。现在靠人读 `lint-design.sh` 注释与 `uiux-standards.md` §0 比对 | 元覆盖缺口 | 让 `uiux-standards.md` §0 的每条 U 编号成为 `lint-design.sh` 报告标签的枚举来源，加一个测试断言「§0 的每个 U 编号都在脚本里出现过」。这是 R7「没有脚本的规范条目视为未落地」的元层落地 |

---

## 三、反向检查：有没有多余的门控

| 门控 | 被哪条 R12 要求 | 结论 |
|---|---|---|
| `check-token-contrast.mjs` | V2 V3 | ✅ |
| `lint-design.sh` | V4 V5 V7 V10 | ✅ |
| `lint-design-gate.test.ts` | V5 | ✅ |
| `single-source-of-truth.test.ts` | V3 V4 | ✅ |
| `verify-ui-states.sh` | V6（+ 承载 identity I-10/I-11 的界面投影 V11/V12） | ✅ |
| `verify-prod-gates.sh` | V8 | ✅ |
| `turbo typecheck/lint/test` | V1 | ✅ |

**七道门控全部有 UC 要求，无孤儿门控。**
其中 `verify-ui-states.sh` 额外承载了 `identity` 束两条不变量的**界面投影**
（承诺 vs 策略可分辨、非项目页不泄漏项目层）——这是**跨束复用**而非孤儿，须在
阶段一致性复核时与 identity 束对齐（见下）。

---

## 四、签核时请重点看这三处

1. **③ 件不产 zod，理由在 domain.md 第三节** —— 请确认这个判断成立：这个束零后端、
   零 mock，硬造 zod 会制造第六次漂移。若认可，本束「③ 件 = 既有门控脚本」是刻意设计。
2. **G-2（V9）是唯一的真产品缺口** —— 「已落地」的 F14 在响应式这一条上**没有机器覆盖，
   只被人肉验过一次**。UC-0.4 R8 承诺「以机器门控代替人类 sign-off、V1–V10 无一依赖人工判断」——
   V9 是这个承诺唯一未兑现的缺口，须裁决是否在 F14 收口前补 Playwright。
3. **G-1 / G-3 是跨/内束的第二份副本** —— 保留名映射（G-1）与豁免清单（G-3）都已经有两处声明，
   是本项目最高发的漂移形态。建议在一致性复核里与「同一事实是否在多处定义」一并收敛。
   ⚠ 收敛方向是**纯 TS 常量单源 + bash 门控 sed 读取**，不是 zod。


---

# G-2 的关闭过程 —— 断言写了三版才真正有效

> 记这一段是因为：**前两版都「全绿」，但都没在测**。
> 这是本项目第五次撞到「门控看起来在跑，其实是空转」，值得把过程留下。

## 第一版：只查 `documentElement.scrollWidth`
```
expect(doc.scrollWidth - innerWidth).toBeLessThanOrEqual(1)
```
**75 个断言全绿。** 然后我塞了一个 900px 的元素进 `/kitchen-sink` ——**它照样绿**。

原因：`AppShell` 最外层是 `overflow-hidden`，内容再宽也被裁掉，
**文档级 scrollWidth 恒等于视口宽**。这个断言在这套骨架下永远为真。

## 第二版：查「被裁且不可滚动」
改为找 `overflow-x: hidden|clip` 且 `scrollWidth > clientWidth` 的容器。
这一版**抓到了真缺陷**：画布在 375/768 下裁掉 245px 且用户拿不到。

但探针仍然漏过——因为 `<main className="overflow-y-auto">` 会被 CSS
**隐式**把 `overflow-x` 也算成 `auto`，于是「主内容列需要横滚」被当成
「可滚动是合法的」放过了。

## 第三版：显式声明制
改为**任何**横向内容超出容器的元素都算缺陷，除非它带 `data-allow-x-scroll="理由"`。
**把「这里的横向滚动是设计」变成显式声明，而不是从 computed style 去猜。**

这一版又抓到两处，性质不同：
- `files-list` 超出 621px —— 是一张 `min-w-[52rem]` 的 7 列表，**横滚确是设计**
  （砍列会丢信息）→ 加 `data-allow-x-scroll`
- `/admin/skill` 超出 2px —— 元素是 `overflow-x: visible`，**内容根本没被裁**，
  只是溢出到父级；父级若裁会被单独抓到 → 规则加一条：跳过 `visible`

## 结果
75 个断言（25 屏 × 3 档）全过，且反证有效：
塞 900px 探针 → 被抓；撤掉 → 通过。

## 留下的两条纪律
1. **写完门控必须立刻造反证。** 「全绿」本身不是证据——它可能是空转。
2. **意图要写出来，不该被推断。** 「这里的横向滚动是设计」用 `data-allow-x-scroll` 声明，
   比让门控从 `overflow-x` 的计算值去猜可靠得多——后者在 CSS 的隐式规则面前必然失灵。
