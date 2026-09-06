# verification · canvas-template-recommendations

## V1 — 推荐来自后台配置，不是代码里写死的一张表
`apps/api/tests/canvas/template-recommendation.test.ts` ①：同一份线程事实，只把 persona
那一行的 `recommendAfter` 改掉（正是管理员在 template-admin 里做的那一个动作），推荐结果
跟着变。⚠ 反证：把梯队①的票数计算删掉，这条即红。

## V2 — 每一轮都给得出下一步（本 delta 第二轮实测反馈的回归判据）
同文件 ⑥：画过的模板一条推荐关系都没配（组织自建的真实形态）⇒ `items` 非空，且不含
刚画过的那张。⚠ 反证：删掉梯队②③（回到「没配过就不推」），这条立刻红。

## V3 — 兜底不制造重复推荐
同文件 ⑦：库里每一张都画过了 ⇒ 返回空。⚠ 「永远有下一步」的前提是还有没画过的模板。

## V4 — 悬空 key 不变成假 chip
同文件 ④：`recommendAfter` 指向库里不存在的 key ⇒ 任何梯队都不产出它。
⚠ 契约明写写入时不校验存在性，所以消费端必须能安静容忍。

## V5 — 起点模板按出度而非 key 字典序
同文件 ③b：字典序排最后、但能带出两个后续的模板，必须排在只能带出零个的前面。
⚠ 反证：实现第一版就是字典序，选出来的是「ai-strategy / burger / freytag」。

## V6 — 落库与全量替换语义
`apps/api/tests/canvas/update-template-metadata-http.test.ts` ⑩⑪：推荐关系真的写进
`canvas_templates.recommend_after`（断言到**库里那一列**，不只是响应体），对已发布行
同样生效且不碰 `sections`；省略 `recommendAfter` ⇒ 清空。

## V7 — 前端只渲染服务端给的那几条，persona 走的仍是专用端点
`apps/web/tests/ui/copilotkit-v2-persona-archived.test.tsx` ⑦：推荐多条逐条渲染后台
`displayName`；点非 persona 的那条走普通发送路径（composer 草稿被清空），且
`summarizePersonaFromThread` 未被调用。⚠ 偷懒把所有 chip 都接到画像端点上，界面看起来
一模一样，产出的却永远是画像。

## V8 — 后台推荐栏不随库增长
`apps/web/tests/ui/canvas-template-live.test.tsx`：30 条库下未选中的一条都不在那一行里；
＋添加→搜索→点选加入；× 移除；候选为空（筛选后只剩自己）时已配置的推荐照常显示且能移除。

## V9 — Esc 只收起浮层，不关掉整个编辑器
同文件：浮层开着按 Esc ⇒ 浮层关、面板还在；再按一次才关面板。
⚠ 反证：浮层自挂 `onKeyDown` 时事件冒泡到面板的 window 监听，一次 Esc 关两层、丢未保存改动。

## V10 — 真栈端到端
`apps/web/e2e/copilotkit-v2-persona-archived.spec.ts`：真登录 → 发一条消息 → 建议行出现
服务端算出的推荐 → 点一条 → 服务端给的 `prompt` 原样作为用户消息进消息区。
⚠ 不断言"模型真的产出了 canvas 围栏"——loopback 替身不照模板产出结构化内容，那属于
`real-model-e2e.md` 那条 lane。
