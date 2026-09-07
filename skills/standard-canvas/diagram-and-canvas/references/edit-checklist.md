# 修改检查

- 关系图先明确节点、方向与关系标签；程序流程不要加入没有业务依据的分支。
- 复用现有节点标识，例如 `A` / `B`；改标签不应顺便重新分配标识。
- 保留完整 Markdown 围栏和已有非目标段落。模板身份使用 key，不用 displayName。
- 不写 x/y 布局坐标；不把服务端 mermaid-source 包装当作真实 DiagramModel。
- 本地原生工具当前仅 replace-source。read 的 supportedOperations 是能力依据，未知操作拒绝。
- 版本策略：旧 revision + 同一意图 key；冲突重新读；未确认合并前不覆盖。
- 源码校验与视觉校验分开记录。浏览器未打开、截图未检查就不承诺图形呈现正确。
