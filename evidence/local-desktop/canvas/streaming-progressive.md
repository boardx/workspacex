# 画布围栏边生成边显示（#3866 R4）

## 改之前
`chat-canvas-fabric.tsx` 的校验 effect 头一句是 `if (!closed) return;`——围栏没闭合就
整个跳过，状态机停在 `validating`。本地版 4B 写一张画布三十多秒，用户这三十多秒
看到的是一行「画布内容生成中…」，然后整张画布一次蹦出来。

## 改之后
围栏其实可渐进解析：写完「模板: bmc」+ 第一个「## 分区」，`checkCanvasFence` 就通过了。
能解析就先画，之后按取样节奏长。

## 实测（真实浏览器，不是 jsdom）
取证页 `/preview/canvas-streaming` 按 ≈30 tok/s 重放一条 268 字的 bmc 围栏，
每 500 ms 采一次 DOM：

| 时刻 | 已写字数 | `chat-canvas-fabric-surface` | 加载态文案 |
|---|---|---|---|
| 0.5s | 13 | ✗ | （还没进视口） |
| 1.0s | 27 | ✗ | 画布内容生成中… |
| 1.5s | 40 | ✗ | 画布内容生成中… |
| **2.0s** | **54** | **✓** | — |
| 2.5s–7.0s | 67→189 | ✓ | — |

**画布在 2.0 秒出现，并且全程没有再退回加载态。** 改之前这张画布要到流结束才出现。

模拟整条流（逐字符，33ms/字符）统计重建次数：**33 次**，不是每个 token 一次。
取样规则见 `apps/web/lib/canvas/streaming-fence-sample.ts`。

## 没有改动的部分
判错的时机一字未改（issue #2298）：未闭合时解析不出来仍然只停在 `validating`，
永远不进错误分支；只有闭合之后内容真的坏了才判错。两条都有反证钉住
（`chat-canvas-streaming-progressive.test.tsx`）。
