# Chat 图形复制桥覆盖与边界

状态：转换基础代码已实现；WB-12 / A11 / A12 **未完成验收**。

## 实际入口

- `packages/fabric-markdown/src/whiteboard-export.ts`：`diagramToWhiteboard(model, importId, offset?)`、`canvasToWhiteboard(canvas, importId, offset?)`。
- 主入口 `src/index.ts` 同时导出；类型 `WhiteboardDiagramCopy` 保留原 `DiagramModel` 语义。
- 本转换器不调用 Mermaid 重排布局，不修改源模型或 Markdown，不生成截图。

## 图型权威与验证

测试直接通过 TypeScript AST 读取 `src/model.ts` 的 `DiagramKind` 联合类型，生成逐类型的数据复制测试，不另存支持图型名单。当前共 15 个类型，13 个 Mermaid 图族和模板/用例两个自定义图族。类型新增会自动增加复制测试。

这证明每个图族的 **IR 数据** 可复制，不证明每个图族已能在 Board 编辑渲染。测试不是 Mermaid 浏览器渲染测试，更不是双客户端协作证据。

| 数据 | 复制规则 |
| --- | --- |
| 节点与边身份 | 节点/边分别使用插入命名空间，源ID映射随导入包保存；边端点映射至新节点 |
| 世界坐标与尺寸 | 保留节点中心与宽高；目标平移作用于节点及序列消息 seqY；不读视口变换 |
| 类成员/方法、生命线 | 原字段深拷贝 |
| 边样式、基数、序列顺序 | kind/sourceLabel/targetLabel/order/seqY 保留 |
| 图型专有数据和 meta | 深拷贝完整字段；源模型不受副本修改影响 |
| 专有 payload 内部引用 | 保持 source-local 命名空间，消费端通过 nodeIds/edgeIds 解析；不猜测任意字符串是否ID |
| 重复插入/重试 | 新 importId 得到独立ID，同 importId 生成稳定ID；服务端幂等/授权尚需实现 |

## 明确不支持与必须完成的集成

当前 `DiagramModel` 缺少任意旋转/斜切/缩放、嵌套 Fabric 组与 child 样式覆盖表示。Canvas 入口对不支持变换、普通 Fabric 对象及悬挂边明确抛错；child 样式覆盖限制写入 diagnostics，调用端应展示损失报告。不能将这些情况视作无损导入通过。

后续 Board adapter 必须保留图族/专有字段并实现对应渲染与编辑。专有引用需要按图族字段的真实语义解析；不能把源局部引用直接当作 Board 对象ID。当前来源授权、稳定 blockId、已闭合围栏、未保存编辑来源哈希、整图原子提交、持久化和双客户端同步均不属于该纯复制桥提供的保障。

A11 仍需每图型真实 Chat → Board 前后视觉证据、可编辑专有属性、已编辑布局与双浏览器刷新后验证。A12 仍需服务端权限负例、幂等及版本隔离验收。

## 本轮验证

- `pnpm --filter @repo/fabric-markdown exec vitest run tests/whiteboard-export.test.ts`：19 passed。
- `pnpm --filter @repo/fabric-markdown exec tsc --noEmit`：通过。
- `pnpm --filter @repo/fabric-markdown exec vitest run`：20 文件、282 tests 全部通过。

未启动 Docker 或完整应用环境。
