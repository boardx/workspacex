# issue #2769 —— /chat run 进度卡：spinner → X 图形标动画（截图证据）

实现：`components/chat/run-progress-x-mark.tsx`（形态来源与约束见其头注）+ `tailwind.config.ts`
的 `x-breathe` / `x-turn` keyframes；接线点 `components/chat/copilotkit-v2-panel-body.tsx` 的
`copilotkit-v2-thinking` 那一行。

## 截图怎么来的（可复现）

不起 Next/CopilotKit（那需要真后端 + 真实 run）——`harness.tsx` 用**真实的** `RunProgressXMark`、
真实的 `lib/agent-run-phase.ts` / `lib/copilotkit-v2-run-progress.ts` 文案常量、以及与面板 body
**同一套 className** 复刻进度卡，静态渲染成 HTML；`tailwind.shots.config.cjs` 复用真实的
`tailwind.config.ts` + `app/globals.css` 编译 CSS（token 值、keyframes 都是真的）；`shoot.mjs`
用 Playwright + 沙箱预装 Chromium 截图，并读 `getComputedStyle().animationName` 证明动画确实挂上
（reduced-motion 下为 `none`）。

```bash
cd apps/web
OUT=node_modules/.cache/x-shots            # 输出目录（不入库）
pnpm exec tsx .run-progress-x-animation/harness.tsx "$OUT"
pnpm exec tailwindcss -c .run-progress-x-animation/tailwind.shots.config.cjs -i app/globals.css -o "$OUT/out.css"
node .run-progress-x-animation/shoot.mjs "$OUT"
```

## 文件

默认方案 A（`x-breathe`，整标呼吸）：

| 文件 | 说明 |
|---|---|
| `running-preparing.png` | running · 准备 阶段（当前阶段高亮） |
| `running-acting.png` | running · 执行 阶段 |
| `running-replying.png` | running · 回复 阶段 |
| `reduced-motion-replying.png` | `prefers-reduced-motion: reduce` —— 静态图形标（animationName=none） |
| `running-replying-dark.png` | `.dark` 主题 |
| `breathe-frame-t0.png` / `breathe-frame-t800.png` | 同一元素相隔 0.8s 的两帧，证明它在动 |
| `mark-48px.png` | 图形标放大到 48px 看形态（四瓣水滴，右大左小） |

备选方案 B（`x-turn`，整标慢速自转）：`candidate-b-turn/` 同名文件。
