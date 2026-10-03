# 踩坑与经验来源

## 2026-10-01 本地交互修复审计

状态：以下经验已对应本地源码与回归入口，**不表示这些 issue 已合并或 CI 全绿**。

- [#4858](https://github.com/boardx/workspacex/issues/4858)：导航只更新 Fabric 会留下 DOM chrome；
  Surface cancel/pan/zoom 必须回传 React viewport。验证 input/coordinate/touch teardown 与真实 transform。
- #4858：FitContent group natural bounds 会改 Sticky/Circle canonical 尺寸；FixedLayout/imperative size
  与 canonical frame 应明确，不用文字自然宽度决定 circle geometry。
- #4858：共享 mtr control 直接改属性会污染其他对象；clone 后放置，截图确认菜单不挡旋转 handle。
- #4858：Highlighter 段段透明叠加会产生结点加深；一次填充轮廓保持单笔 alpha，交叉笔画仍可加深。
- #4858：Group cache 裁剪 round cap；扩大 cache 而不是扩 canonical geometry，独立cache保护 eraser 下层。
- [#4859](https://github.com/boardx/workspacex/issues/4859)：armed creation 点击已有对象需暂停 targetFind；
  关闭 selection alone 不够。旧 context toolbar 也要隐藏，menu bbox 合规不代表未被覆盖。
- #4859：chrome inset 变动重复消费旧 fitRequest 会在选择/取消后跳视口；新 request/真实尺寸变化才重 fit。
- [#4860](https://github.com/boardx/workspacex/issues/4860)：上传 retry 要保留坐标和替换目标，await 后检查
  目标是否还存在/未锁；会话 objectUrl 预览不是图片持久化。
- [#4861](https://github.com/boardx/workspacex/issues/4861)：普通文件是有 ACL、digest、GC root 的资产引用；
  暂不支持 copy/backup/portable 必须明确拒绝，不能用 UI file tile 显示声称生命周期已支持。
- [#4878](https://github.com/boardx/workspacex/issues/4878)：FigJam 对标需求不等于产品完成；
  路径手柄/持久化粗细/标签位置仍要设计签核、实际实现和 C01–C21 验收。

## 同轮后续回流

- #4878 上述仅设计状态已被人类批准开发和本地实现替代，未表示合入/全套验收。
  world path 与 bbox 不得重复缩放；release 用 live Y.Doc + 命令端 CAS，旧 route absence 保留兼容。
  具体入口和坐标约束见 [输入与投影](input-and-projection.md)，不在此重复公式。
- [#4222](https://github.com/boardx/workspacex/issues/4222)：圆形 overflow 的 padding 不能约束
  滚动后内容；真实内接滚动视口、top-left rotation 与 font-load 无写入/dirty-caret 保留必须一起测。
  helper 与回归入口同见 [输入与投影](input-and-projection.md)。
- 冲突拒绝测试必须先证明 winning mutation；双端验收需实际独立 browser process 与应用源码冻结。
  判据见 [真实验收](verification.md)，不能由静态 fixture 注释或 runner hash 推断通过。

## 2026-10-02 精确回流索引

- Hand 远端刷新/首步误拖的实际代码、4 个 RED→GREEN 和会议长测未通过边界，
  只在 [输入与投影](input-and-projection.md#hand-与-canonical-refresh-的交互边界) 维护详细记录。
- lower-canvas selection control 遮笔迹的 R05 原 RED 与诊断更正，以及 mock Group
  bounds 的独立 oracle 边界，见 [像素 Oracle 与归因更正](verification.md#像素-oracle-与归因更正)。
- 精确 Playwright core CLI、Turbo plan/execute 参数的代码单源和旧缺 Chromium 日志，
  见 [CI 前提](verification.md#ci-前提)。本索引不复制 runner 或其安装策略。

## 2026-10-03 Shape 逻辑边界与缓存支持域

Shape 的 FixedLayout 逻辑容器与子对象描边的可见外沿不是同一边界。不能把子对象
描边吸收到 canonical width/height，也不能用去掉默认描边的 fixture 代替用户对象。
逻辑尺寸修正见 [PR #5155](https://github.com/boardx/workspacex/pull/5155)，缓存支持域修正见
[PR #5169](https://github.com/boardx/workspacex/pull/5169)。后者只扩投影缓存支持域，
不扩大 canonical geometry、不全局关闭缓存；`strokeUniform`、父级缩放与 viewport/retina
缩放必须分别核验。算法仅以该 PR 的
[ShapeProjectionGroup 源码](https://github.com/boardx/workspacex/blob/8ae84fd715eb5018d5f79075f83f05a6c4a592bc/apps/web/components/whiteboard/fabric/shape-projection-group.ts)
为单源，此处不复制 padding 公式。

缓存尺寸、实际平移后的左右/上下支持范围、缓存上限与 canonical 重建稳定性是不同门。
尺寸门通过不等于像素完整，达到 Fabric 缓存上限也不等于保留了全分辨率描边。
本轮实际证据与未验边界见 [Shape 缓存证据分层](verification.md#shape-缓存证据分层)。

## 回流模板

```text
- YYYY-MM-DD：现象与适用条件；根因；修正源码/helper；失败反例测试；
  证据(issue/PR/exact SHA/日志或截图)，实际验证范围；未验证限制。
```

避免粘贴 schema/公式/颜色常量/整份日志；引用源码或契约单源。
推翻旧经验：原条目保留并标被哪一条取代，不能把历史事故改写成从未发生。
追加经验可以随功能 PR；新规则/重组/权限与完成定义变更必须走正常 review。
