# 独立源码复核

复核者：本次独立 rev-feature 子 agent `/root/review_ui`（只读，不参与实现）。

范围：`0acfa6628f9380c64ece5732c066e999d2e57651..b7b0e6e87ec66423e3d2e8521f2b5b8a4b0b84ce`。

结论：未确认新增 P1/P2，可交主会话验收。这是源码结论，不等于人类设计签核或最终主会话验收。

- 相同错误重试前会清空error，失败再设置，继续触发错误焦点。
- alert的tabIndex=-1不新增Tab停靠点，原Radix开/关焦点处理保留。
- busy guard、payload fingerprint/requestId、输入保留和只读路径/API未变。
- R3局部高度上限与内部滚动未改共享Dialog。
- base已有pending可取消/迟到响应竞态不作为本次新增问题；未扩大范围处理。
- 未额外启动测试；测试与浏览器证据各自在本目录记录。后续若产品代码变化，需要重新核对。
