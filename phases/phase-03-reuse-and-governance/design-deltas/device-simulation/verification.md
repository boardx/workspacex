# verification · device-simulation（迭代 14）

> 每条都写**反证**——把哪一行删掉这条就红。写不出反证的验收线索不算验收线索。
> 编号接 `design-chat-inputs` 的 V51–V70。

## V71 — 预设是闭集，尺寸是真实逻辑分辨率
`apps/web/tests/ui/prototype-devices.test.ts`：id 唯一；iPhone 恰为 393×852；
可旋转的预设高 > 宽，不可旋转的宽 > 高。
⚠ 反证：把 iPhone 改回 300×560 这种"看着像手机"的尺寸 ⇒ 红。比例不真，
「这行字在真机上有多小」就答不出来，模拟失去意义。

## V72 — 认不得的预设 id 回落默认，不崩
同文件：`presetById("no-such-device")` / `presetById("")` ⇒ 默认预设。
⚠ 反证：改成返回 `undefined` ⇒ 红；将来删掉一个预设时，用户组件状态里的旧 id
会让整块画布崩掉。

## V73 — 旋转只对可旋转的预设生效
同文件 + `design-loop.test.tsx`：iPad 交换宽高；笔记本 `rotatable: false`，
`rotated(laptop, true)` 原样返回，按钮禁用，`data-landscape` 为 false。
⚠ 反证：`rotated` 不判 `rotatable` ⇒ 红，桌面会变成 800×1280 的竖条。

## V74 — fitScale 只缩不放，且不产生 Infinity/NaN
`prototype-devices.test.ts`：装得下 ⇒ 1；按更紧的一维缩；容器 4000×4000 ⇒ 仍是 1；
容器或设备任一维为 0 / 负 ⇒ 1 且 `Number.isFinite`。
⚠ 反证：去掉 `Math.min(1, …)` ⇒ 「永远不放大」那条红。放大会让字变大、看起来"很清楚"，
把模拟要回答的问题抹掉。
⚠ 反证：不挡 0 ⇒ 除数为 0 得到 Infinity，画板宽度变成 NaN。

## V75 — 镜头**不写库**
`design-loop.test.tsx`：切设备 + 旋转之后，`PATCH /pm-designs/:id` **一次都没发**。
⚠ 反证：把镜头做成 `DesignProject` 的字段（像 `theme` 那样 PATCH）⇒ 红。
**这是本 delta 最重要的一条**：它是「这稿是给什么设备的」与「我现在用什么尺寸看」
不混为一谈的唯一机械保证。

## V76 — 默认镜头跟模板走，切换后尺寸与形态都变
同文件：template mobile ⇒ `data-device="iphone"` / `data-chrome="phone"` / 宽 393px；
切到 laptop ⇒ `browser` / 1280px。
⚠ 反证：尺寸仍从迭代 6 的 `DEVICE_SIZE` 三档来 ⇒ 宽度不会是 1280，红。

## V77 — chrome 真的画出来了，且是装饰不是原语
同文件：iPhone 有 island + status + home，无 browser；SE 是 notch 不是 island；
laptop 有 browser、无 home。且 `design-detail-phone-tree` 内**没有任何** `[data-chrome]`。
⚠ 反证：chrome 只换圆角不画状态栏/工具栏 ⇒ 这一组全红，"模拟"只剩空壳。
⚠ 反证：把 chrome 放进原语树 ⇒ 「选不中」那条红；属性面板会多出一批改不了的目标。

## 未覆盖（如实记）
- **真浏览器里的缩放行为**没有 e2e：`ResizeObserver` 在 jsdom 里不存在，`fitScale` 只作为
  纯函数被验证。真实的"量容器 → 缩放"这条链路目前只有肉眼。补它要等 issue #3138
  （三个 playwright project 从未在 CI 上跑过）落地，否则写了也不会被执行。
