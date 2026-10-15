# Board 原生思维导图设计增量（#5682）

状态：Proposed；日期：2026-10-14。本文件是可审阅方案，不是功能完成或人类签核记录。当前统一 PR 可携带此设计，不能据此声称已经提供原生 mindmap。

## 背景与源码依据

用户希望参考 Fabric Mermaid 的思维导图能力，同时继续使用 Board 的便利贴和连接线，避免引入第二套画布对象。

- `packages/fabric-markdown/src/diagrams/mindmap.ts` 已有 `layoutMindmap`、`styleMindmap`、`reparent`、`serializeMindmap`；其中 `reparent` 通过 incoming edge 的 source 表示父节点，并拒绝重挂根节点、循环和无效节点。
- `packages/fabric-markdown/src/interactions/mindmap-editor.ts` 的 `attachMindmapEditor` 直接维护 FlowNode/FlowEdge 和 Fabric canvas。直接挂到 Board 会绕过 canonical 文档、operation、撤销与同步通道。
- `apps/web/components/whiteboard/collaborative-thinking-editor.tsx` 当前 `mind-map` 选项仅调用两列 grid 排列；这不是结构化思维导图。
- `packages/contracts/src/whiteboard-document.ts` 已有 sticky、connector、extensionData 与批量命令。现有对象 `parentId` 是 frame/group 容器关系，不应复用为便利贴的树父关系。
- 已签 phase-19 board-fabric 范围 BV01–03 不涵盖新增树语义。需要新的契约增量及 UI、用例、API 签核，不修改旧签核 status。

以上是当前源码调研，未运行测试，也未执行产品开发。

## 推荐决策与备选

推荐“结构关系 + 独立纯布局”：节点继续是 sticky，树边继续是 connector；树关系的唯一事实存在标记为 mindmap-edge 的 connector 上。纯函数读取 canonical 节点和边，计算布局，再由 Board 原子 command batch 提交坐标。Fabric 只投影最终结果。

| 方案 | 能提供的行为 | 代价与判断 |
| --- | --- | --- |
| 只增加树形 layout | 一次性排列便利贴 | 不知道父子关系，Tab、重挂、折叠、导入导出都不可靠；不满足需求 |
| 节点另存 parent 与连接线并存 | 较容易查询父节点 | 产生两份父子事实，删除和同步易漂移；不采用 |
| 树边为唯一父关系，纯布局派生坐标 | 结构操作、布局、撤销、协作共用原生对象 | 必须新增结构验证和并发拒绝机制；推荐 |
| 直接接 attachMindmapEditor | 能快速展示 Mermaid 现有交互 | 绕过 Board canonical operation；不采用 |

负面后果：每次结构操作需要检查完整受影响树；大树布局需要有工作量上限与取消能力。布局批次会更新多个 geometry，需合并为一次操作；不能逐个提交导致半棵树状态。第一期限制单根、有序、单父树，不承诺任意图结构或双侧布局。

## 最小 schema（提案，尚未注册）

在共享 contracts 声明并验证以下 extensionData 命名空间，不能在 UI 自定义一套未经验证的 JSON：

```ts
type MindmapNodeMetadata = {
  version: 1;
  role: 'node';
  treeId: string; // root sticky id；身份复用对象 id
  collapsed: boolean;
};
type MindmapEdgeMetadata = {
  version: 1;
  role: 'edge';
  treeId: string;
  siblingOrder: string; // 专用稳定排序键，不复用对象 z-order
};
// object.extensionData.mindmap = 上述类型之一
// 父关系只在 edge.connector.from -> edge.connector.to；节点无 parent 副本。
```

root 的定义是 `node.id === treeId` 且没有树入边。普通 connector 可以连接树节点，但不参与树遍历；不通过端点形状猜测树边。禁止树边的自由端点，禁止树边指向其他 treeId、非 sticky、已删除对象或重复父节点。所有成员可先保持 `parentId = null`；未来容器归属仍按原容器契约独立处理。

排序以 `(siblingOrder, edge.id)` 决定确定性顺序，同键有稳定 tie-break。插入采用现有排序工具支持的可插入键；不得假设当前对象 orderKey 具有此用途。键重平衡是同一原子结构操作的一部分。

## Command 与一致性增量

建议在共享 contracts 增加一个 `mindmap` 领域 command 家族，经现有 operation dispatcher 执行；参数和权限由服务端权威校验，UI 不直接编辑关系对象：

| Command | 输入 | 原子效果 |
| --- | --- | --- |
| `create-root` | rootId、text、position | 新建一个 root sticky 与 node metadata |
| `add-child` | parentId、nodeId、edgeId、text、afterSiblingId? | 新建 sticky + 树边，更新受影响树布局并选中新节点 |
| `add-sibling` | nodeId、newNodeId、edgeId、text | 按 incoming edge 派生父节点；根节点拒绝 |
| `reparent` | nodeId、newParentId、afterSiblingId? | 更新唯一入边及排序，不删除重建对象；整棵受影响树重排 |
| `set-collapsed` | nodeId、collapsed | 更新折叠属性；派生可见性，不删子树 |
| `layout` | treeId、direction: 'LR' | 按当前树及实际节点尺寸计算位置，保留根位置 |
| `delete-subtree` | nodeId | 原子删除后代与树边；按现有规则清理普通连接线 |
| `import-mermaid` | text、rootPosition | 分配一次 Board id 映射，创建全部节点边，单次撤销 |

不是简单把普通 create/connector 命令拼起来就完成：服务端必须检查最终 batch 的单父、单根、无循环、边端点与成员一致。两个客户端并发重挂同一节点、或相互重挂，必须以服务端文档序列/版本前置条件串行校验；失败回滚整个操作并保留首错。单纯 CRDT 合并两条局部合法关系可能产生环，因此客户端 DFS 不能作为唯一防线。新验证需覆盖持久化恢复与服务端重放路径。

撤销/重做保留 node/edge identity、排序和 geometry，属于一个 operation；重挂、导入、布局都不能分成多个 undo 步骤。只读用户不能结构编辑。锁定节点及受影响后代/边遵循已有锁策略；不能在 layout 中隐式解锁。

## 布局边界与一期 UI

第一期使用 LR 有序树。将 sticky 文本排版后的宽高传入布局，按子树总高度分配空间；根位置为锚点。可以适配 `layoutMindmap` 的纯计算，但其输入 DiagramModel 是临时适配视图，不保存第二份模型，`styleMindmap` 不得覆盖用户便利贴颜色和字号。若布局假设固定尺寸，需要先扩展为可变宽高纯算法。

UI 草图：

```text
[中心主题] ─┬─ [分支一] ── [子主题]
            └─ [分支二]
选中节点工具条：[新增子主题 Tab] [新增同级 Enter] [折叠/展开] [整理布局]
```

新增原生思维导图入口必须明确与现有“排列”区分。已有 mind-map 网格选项需替换为明确操作，普通便利贴不能无确认地批量转树。Tab 只在已选 mindmap 节点且画布拥有焦点时新增子节点；Enter 新增同级。文本编辑、输入框和菜单中的 Tab/Enter 保持原用途。一般 Board 的 Tab 新建同类型对象需求是另一个契约，按 mindmap 模式明确分流。

拖节点自由移动仅改 geometry；拖到另一节点的重挂区域才预览结构改变，松手后原子重挂。折叠只影响当前树的派生可见性，原有对象 hidden 字段不被污染；隐藏后代不参与命中、a11y 选中和框选，导出结构仍包含全部节点。第一期折叠属性协作共享，此 UX 需要人类确认。

一期包含：单根 sticky 树、曲线 connector、子/同级新增、显式重挂、折叠、单次撤销、协作刷新、Mermaid 导入导出。暂缓：自动从普通图推树、跨树合并、双侧/径向布局、AI 生树、任意节点类型。Mermaid 文本只表达标签与树结构，坐标绝不写回文本；Board geometry 仍保存在原文档中。

## 用例与验证计划（未执行）

1. 创建根 → Tab 子 → Enter 同级：节点数量、单父边和排序正确，键盘焦点选中新节点。
2. 重挂子树：保留全体 id；拒绝自己/后代/跨树/根重挂；拒绝时 canonical 哈希不变。
3. 可变文字尺寸布局：中英文、长文本、深树不重叠，根位置不变；同输入产生同输出。
4. 折叠/展开：成员数量和 Mermaid 文本不变；可见、命中与 a11y 一致，刷新后状态恢复。
5. 两个真实浏览器并发新增、重挂、互相构造环：服务端拒绝冲突，两个客户端最终收敛；首错保留。
6. 每个结构操作一次 undo/redo 完整恢复，peer 与刷新结果一致；ordinary connector 不进入树关系。
7. owner/editor 正常写入，viewer/commenter 结构写入拒绝；锁定对象不被自动布局修改。
8. Mermaid import → Board 编辑 → export → reimport：树关系和文本往返，导出中没有 geometry 数值。

纯函数测试不足以证明交互和协作。正式落地时必须增加共享 schema/domain 负向测试、core 原子操作和并发测试、真实浏览器快捷键/拖拽/刷新/peer 验证及 UI 截图；具体命令待实现测试注册后由 root 核对执行，当前无 PASS 记录。

## 可审阅清单与签核缺口

- [ ] UI：新建入口、选中工具条、快捷键分流、重挂预览、共享折叠需要实际可审阅原型。
- [ ] 用例：确认单根 LR、锁定受影响子树的拒绝策略、删除子树行为、暂缓项。
- [ ] API：批准 typed metadata、mindmap command、版本前置条件与服务端串行结构验证。
- [ ] 一致性复核：普通 Board、Fabric Mermaid 与新增树身份/序列化/协作边界不重复事实源。
- [ ] 在新的契约束 `design-signoff.md` 由人类签署 UI、用例、API；本提案不代签，不改变旧签核。

上述批准后才把结构功能拆成受门控的实现与测试注册；统一 PR 可以先交付已验证的修复与这份待签设计。
