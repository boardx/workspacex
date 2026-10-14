# R01 N05 默认橡皮擦宽度与旧独立 oracle 不一致

状态：N05 实际失败，未改 oracle，未声明通过。本记录为只读源码调查；新纯回归由 root 执行。

实际日志：`/private/tmp/wsx-native-ci-5647fc46-8567-4bef-b769-9d9d793a162c/execution.log`。N05 `board-r01-native-matrix.spec.ts:186` 期望 `10`，实际 `20`。

## 可核对的首因

- 已合入的 `f5b46c42cea7bd127c5457ad03c12e457449ccd5`（2026-10-05，#5356）的 `drawing-tool-style.ts` diff 明确将默认橡皮擦宽度从 `24` 改为 `48`。
- 当前 `drawing-tool-style.ts` 的单源默认值仍为 `48`。固定宽度面板、Surface 实时外观、目标命中与 Editor commit 均使用这个值。
- `drawing-coordinate-space.ts:worldStrokeToDrawingSpace` 用捕获的 world 宽度乘 `min(intrinsicWidth/worldWidth, intrinsicHeight/worldHeight)`；它不重新定义默认工具宽度。
- 正式 N05 没有配置橡皮擦宽度，而 `spec:186` 仍硬编码旧 `24` 乘相同的坐标换算比。因此相同缩放下当前 `48` 的 intrinsic 宽度是旧 `24` 期望值的两倍；日志 `20/10` 与此相符。没有证据表明换算丢失了缩放、旋转或宽度标量。

## 本轮处理边界

没有为了绿色结果把独立 oracle 改为 `48`，也没有把已合入的产品默认值回退成 `24`。保留旧 24px 参数回归，追加捕获 48px 在 2.4 倍统一缩放和非均匀旋转缩放下的真实 Fabric 渲染宽度回归；这不能代替 N05 的正式浏览器验收。

后续须明确对齐当前固定默认宽度与正式验收规格：若默认 `48` 是继续保留的产品行为，应以确认后的标准审阅修订独立 oracle；若仍要求 `24`，应审阅回退默认值对实时光标、命中和持久化的影响。两者均须 root 实测，当前 N05 维持 FAIL。
