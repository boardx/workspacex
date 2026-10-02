> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural 交互审计与方案

状态：审计/设计材料，未签核；既有规则 bug 的最小修与新产品行为分开，不声明已交付。

## 官方参考与产品边界

已读取 [Mural 官方课程](https://learning.mural.co/lessons/add-create-and-customize-sticky-notes)（2026-10-01）：工具栏允许先选择形状/默认颜色再拖到画布；空白双击会参考邻近便笺形状和颜色；课程摘要还描述 Tab 快速添加下一张。它没有为本产品确定 Enter、Esc、IME、冲突、rich text、文本溢出或撤销粒度。

本产品既有签核范围是单次 click/drag-out 创建后回 Select，保留 picker 选择颜色/形状、不因取消追加对象。Mural 的邻近复制、持续连创不是单次创建规则的自然推论。

## 当前实现与可实施缺口

- `createStickyAt` 经 batch envelope 创建 canonical，再进入 inline edit；`createFromTool` 成功后清 creationTool 并回 Select，拖入 payload 使用既有校验 helper。
- dock 保留本会话形状/颜色；editor stickyColor 初始为默认值。没有跨会话 recent 列表或邻近对象选择策略，不把这两者称作已实现。
- inline editor 下一 animation frame focus/select，避免 Fabric pointerdown 再夺焦；已有 composition 抑制、100ms live text coalescing、Ctrl/Meta+Enter 提交、普通 Enter 换行、blur 提交。Esc 会 flush 尚未提交文本后关闭，不是回滚全部输入。
- 本轮失败回归确认 pending draft 在 remote text 后 blur 被替换为 remote 值，以及 remote delete 卸载时未保存草稿。最小修使用 dirty-aware initial 同步、accepted-value ref 和现有 conflictedDraft 回调：clean 输入跟随远端，dirty 输入不被覆盖，正常接受后不重复保留；权限/锁定变化退出也保护 composition 已接收的最新 draft。未改变 debounce 历史粒度。
- 明确 bug：armed N 后 Esc 原本不清 creationTool，之后 click 仍创建。已先写反例并观察失败，最小修清 armed 状态回 Select，不改 doubleclick/Tab 产品选择。
- core 已拒绝锁定文本写；editor beginEditing/commitEdit 仍需显式检查最新对象存活/locked/mutationBlocked，拒绝时保留草稿并结束编辑。该修不替代 core/服务端鉴权。
- transformPreview 已驱动 toolbar/handles；inline textarea 的旋转 pivot/文本布局和 Fabric 一致性须独立真实像素核对。canvas owner 报告疑似 center-vs-origin 差异，尚非已经验证的缺陷；本轮未改几何/布局算法。

## 待人类确认

| 决策 | 现状/选择边界 |
| --- | --- |
| 空白双击 | 目前可直接创建默认 square；是否采用邻近颜色/形状、邻近半径及多个邻居优先级需确认 |
| Tab 连创 | 当前存在继续下一张入口；是否采纳、是否只 sticky、颜色/shape 沿源还是 recent、cancel 如何结束需确认 |
| Esc 输入 | 保留 live committed 文本关闭，或全 session 回滚，是不同产品语义；不默改 |
| Enter/IME | 当前普通 Enter 换行、Ctrl/Meta+Enter 结束；IME Enter 不结束；是否改普通 Enter 确认需签核 |
| 富文本 | 当前 canonical/plain text 及既有 style；新 span/rich-text schema 不在 editor 发明 |
| 文本溢出/圆形 | 固定、自动高度、自动字体缩小/截断等策略须确认，避免 textarea/Fabric 各自定义布局算法 |
| recent | 会话内 last 选择与跨会话 history、邻近复制分开；持久化范围/权限/上限需确认 |

## 权限、竞争与撤销

提交前重读 current object，拒绝已删除/锁定/只读/布局预览。远端文本改变按当前 conflict draft 保留规则，不盲写旧 initial；异步 focus/debounce/unmount 不能恢复过时 editing session。begin-created 的临时宽限窗口不能成为远端删除后复活对象的依据。

一次对象 drag/创建对应一次命令事务和 undo；文本输入保留当前 live coalescing 历史粒度，不未经准则把整段 session 合为一 undo。修改颜色/shape 应原子更新 style/metadata/geometry，拒绝不产生半对象。

## 验证目标与边界

1. armed N/click、picker drag-out、点击已有对象创建：恰好一对象、准确 world center/shape/color、完成 Select、后续空白不追加；Esc/dragcancel 不追加。
2. focus 后可输入；Enter/CtrlEnter/Esc/blur 与 composition start/end/Enter/blur 重叠序列不重复提交、不丢最终文本；native OS IME 另列硬件证据，不把 synthetic events 称为真实硬件。
3. 编辑期间远端 delete/lock/text change、permission→viewer/archive、layoutPreview：末端重验、无非法 write，草稿与取消状态明确；真实 API head 和第二浏览器验证。
4. move/rotate/resize live screenshot：toolbar/handles/textarea 与对象一致；390px 每个菜单按钮中心 elementFromPoint 命中、root scrollLeft 不漂移；独立几何与像素 oracle。
5. 保存 ACK→API readback→reload shape/color/text，再单次 undo/redo 验证对象动作；文本历史粒度独立记录。错误、截图缺失、伪 viewer 或 mock 成功禁止报 PASS。

当前最小反例与验证入口为 `board-content-tools.test.tsx`、`thinking-input-interactions.test.tsx`。真实 Mural 风格新交互脚本尚未开发/执行；不自动启动 runtime/Docker，不读取隐式凭据。后续先共同确认 canvas layout helper 与设计标准，再扩新行为。
