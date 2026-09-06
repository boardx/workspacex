# issue #2785 —— /chat run 进度卡：X 图形标 → 蝴蝶主题动画（截图证据）

实现：`components/chat/run-progress-butterfly.tsx`（形态来源与约束见其头注）+
`tailwind.config.ts` 的 `butterfly-flap` / `butterfly-drift` keyframes；接线点
`components/chat/copilotkit-v2-panel-body.tsx` 的 `copilotkit-v2-thinking` 那一行。
顶替 issue #2769 / PR #2772 的 `RunProgressXMark`（已整体退役：组件、测试、
`x-breathe`/`x-turn` keyframes、`.run-progress-x-animation/` 截图目录都已删除）。

## 截图怎么来的（可复现）

不起 Next/CopilotKit（那需要真后端 + 真实 run）——`harness.tsx` 用**真实的**
`RunProgressButterfly`、真实的 `lib/agent-run-phase.ts` / `lib/copilotkit-v2-run-progress.ts`
文案常量、以及与面板 body **同一套 className** 复刻进度卡，静态渲染成 HTML；
`tailwind.shots.config.cjs` 复用真实的 `tailwind.config.ts` + `app/globals.css` 编译
CSS（token 值、keyframes 都是真的）；`shoot.mjs` 用 Playwright + 沙箱预装 Chromium
截图，并读 `getComputedStyle().animationName` 证明动画确实挂上（reduced-motion 下为
`none`）。

```bash
cd apps/web
OUT=node_modules/.cache/butterfly-shots      # 输出目录（不入库）
pnpm exec tsx .run-progress-butterfly-animation/harness.tsx "$OUT"
pnpm exec tailwindcss -c .run-progress-butterfly-animation/tailwind.shots.config.cjs -i app/globals.css -o "$OUT/out.css"
node .run-progress-butterfly-animation/shoot.mjs "$OUT"
# 本机没有 /opt/pw-browsers/chromium（沙箱路径）时，传空串让 Playwright 用自带的 Chromium：
#   CHROMIUM_PATH="" node .run-progress-butterfly-animation/shoot.mjs "$OUT"
```

## 两个候选方案（issue 要求：定稿前先贴 2 个候选让人类挑）

- **方案 A `flap`（默认，`candidate-a-flap.png`）**：整枚图形沿水平 `scaleX` 收放
  （0% 全展开 ↔ 50% 收拢到一半），配一点透明度起伏——视觉上是"翅膀开合"。
- **方案 B `drift`（`candidate-b-drift.png`）**：整枚图形 `translateY` 小幅浮动 +
  轻微 `rotate`——视觉上是"飞行时忽高忽低、左右打晃"。

`flap-frame-t0.png` / `flap-frame-t550.png`（以及 `candidate-b-drift/drift-frame-t0.png`
/ `drift-frame-t900.png`）是同一元素相隔约半个动画周期的两帧，证明它在动而不是
一张静止图。

## 文件

默认方案 A（`flap`）：

| 文件 | 说明 |
|---|---|
| `candidate-a-flap.png` | 候选整版（标题 + 三阶段卡 + 放大图形标一次看全） |
| `running-preparing.png` | running · 准备 阶段（当前阶段高亮） |
| `running-acting.png` | running · 执行 阶段 |
| `running-replying.png` | running · 回复 阶段（含 45s longrun 提示） |
| `reduced-motion-replying.png` | `prefers-reduced-motion: reduce` —— 静态蝴蝶形（animationName=none） |
| `running-replying-dark.png` | `.dark` 主题 |
| `flap-frame-t0.png` / `flap-frame-t550.png` | 同一元素相隔 0.55s 的两帧，证明它在动 |
| `mark-48px.png` | 图形标放大到 48px 看形态（细身体 + 上大下小两对翅膀） |

备选方案 B（`drift`）：`candidate-b-drift/` 同名文件 + 顶层 `candidate-b-drift.png`。

## 验证

- `pnpm --filter web exec vitest run tests/chat/run-progress-butterfly.test.tsx`
- `pnpm --filter web run lint`
- `apps/web/scripts/lint-design.sh`

## issue #2837（2026-09-06）—— 放大到 28px + 方案 C `fly`（默认）

人类实测长任务里 12px 图形太小、单独 flap 机械。默认尺寸 `h-3 w-3` → `h-7 w-7`；新增
`butterfly-fly` keyframes（flap + drift 合成为同一段：一个周期上浮一次、扑翼两次），
进度卡布局改为「左蝴蝶竖向居中 + 右两行文案（`text-12` / `text-13`）」，`rounded-xl px-4 py-3`。
`harness.tsx` 不再复刻卡片：直接渲染生产用的 `components/chat/run-progress-card.tsx`（面板 body
用的同一个组件，PR #2839 review 抽出），截图即真实 UI；`shoot.mjs` 多出 `fly` 一组，跑法同上。

| 文件 | 说明 |
|---|---|
| `candidate-c-fly.png` | 方案 C 整版（三阶段卡 + 放大图形标） |
| `fly-2837/fly-preparing.png` / `fly-acting.png` / `fly-replying.png` | running 三阶段（当前阶段高亮） |
| `fly-2837/fly-replying-dark.png` | `.dark` 主题 |
| `fly-2837/fly-replying-reduced-motion.png` | `prefers-reduced-motion: reduce`，animationName=none |
| `fly-2837/fly-frame-t0.png` / `fly-frame-t400.png` | 同一元素相隔 0.4s（1/4 周期）：t400 是收翅+上浮那一帧 |
| `fly-2837/fly-large.png` | 48px 放大形态 |
