# Board 9 分产品验收 Backlog

状态：执行中。评分基准为 Mural 的目标体验等于 10 分；WorkspaceX Board 只有同时达到总分 90/100 和全部硬门槛，才可声明达到 9 分。代码存在、单元测试通过或 PR 已创建均不能单独加分，必须以用户可完成的行为和验收证据计分。

## 评分与硬门槛

| 维度 | 权重 | 9 分出口 |
| --- | ---: | --- |
| 便利贴与画布效率 | 18 | 高频工作不依赖鼠标，批量整理与连接接近成熟白板 |
| 多人协作与可靠性 | 15 | 50 人、弱网、重连、撤权和历史恢复无数据丢失 |
| 工作坊与模板 | 14 | 主持人可独立完成一场 60 分钟工作坊 |
| Miro/Mural 迁移 | 15 | 可预检、可追踪、可重试，零静默丢失 |
| 无障碍与移动端 | 10 | WCAG 2.2 AA，键盘、屏幕阅读器、手机和平板可操作 |
| 性能与运维 | 12 | 10k 大板可用，自托管可观测且可备份恢复 |
| AI、开放 API 与扩展 | 10 | 人和 AI 遵守同一权限、版本、审计和提案模型 |
| 会议室体验 | 6 | 安全配对、只读大屏、跟随、断线恢复完整 |

以下门槛不可用其他维度的分数抵消：

1. 迁移的支持对象语义保留率不低于 95%，父子与连接关系完整率为 100%，所有降级和跳过项均进入用户可见报告。
2. 50 个真实或受控浏览器客户端持续协作 30 分钟，零丢操作、零分叉；弱网恢复后文档哈希一致。
3. axe 无 serious/critical，关键流程满足 WCAG 2.2 AA，并有全键盘和屏幕阅读器替代视图证据。
4. 至少迁移 3 块真实 Miro/Mural 白板，并使用迁移后的白板完成一场不少于 10 人、60 分钟的工作坊。
5. 试点团队连续两周在约定范围内无需退回 Miro/Mural；所有回退原因都有记录和处置结论。

状态只使用 `ready`、`in_progress`、`verified`、`blocked`。`verified` 需要 issue、已合入主干的 PR、绿色 CI 和下表验收证据；堆叠 PR 中的能力仍为 `in_progress`。

## A. 便利贴与画布效率（18 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| UX-01 | P0 | in_progress | `N` 新建、Enter 编辑、Cmd/Ctrl+Enter 完成、Tab 连续创建；用户录入 20 张便签不需鼠标，中文 IME 不丢字 | Yjs 对象命令 |
| UX-02 | P0 | in_progress | 粘贴最多 500 行生成整齐便签；先预览数量和布局，一次事务提交，一次撤销完整回退 | UX-01 |
| UX-03 | P0 | ready | 便签颜色、字号、字体、对齐、自动尺寸可批量修改；两客户端并发修改文字和格式不相互覆盖 | 文本 CRDT |
| UX-04 | P0 | ready | 2–500 个对象可对齐、等距分布、统一尺寸/颜色；远端只观察到完整事务结果 | 批量命令 |
| UX-05 | P0 | ready | 拖动显示吸附线、间距和 Frame 边界；可关闭吸附，各缩放级误差不超过 2 屏幕像素 | 渲染器 |
| UX-06 | P1 | ready | 锁定、前后移动、隐藏、按类型/Frame 选择；无权限成员不能解锁，层级顺序跨客户端一致 | orderKey/权限 |
| UX-07 | P0 | in_progress | Frame 是真实容器；拖入/拖出更新父子关系，移动 Frame 带动子项，提供行列自动布局 | Frame/Group |
| UX-08 | P1 | ready | 连接线有端点、标签、箭头和自动绕行；移动、复制、导入后端点仍正确 | Connector 模型 |
| UX-09 | P1 | ready | 搜索、缩略图、小地图和 Frame 大纲可定位；10k 对象下跳转响应低于 100ms | 空间索引 |

## B. 多人协作、离线与历史（15 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| COL-01 | P0 | in_progress | 50 人编辑 30 分钟零丢操作、零顺序分叉，远端更新 p95 不高于 300ms | Yjs 网关 |
| COL-02 | P0 | in_progress | 30 秒断网、乱序、重复更新后自动收敛，重连不超过 5 秒 | 离线队列 |
| COL-03 | P0 | in_progress | UI 准确区分离线、同步、已保存和权限失效；退出登录隔离本地队列，禁止假绿 | COL-02 |
| COL-04 | P1 | in_progress | 命名版本可比较、复制和恢复；恢复创建新历史节点并记录操作者/原因，不覆盖后来版本 | 检查点 |
| COL-05 | P0 | in_progress | 成员、访客、viewer/editor/owner 服务端授权一致；撤权立即阻断 HTTP、WS 和本地重放 | 身份域 |
| COL-06 | P1 | ready | 用户按姓名/邮箱邀请成员，访客链接可设到期时间及只读/评论权限，不要求手填 user ID | COL-05 |

## C. 工作坊与模板（14 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| WS-01 | P0 | in_progress | 主持人发起“跟随我”，成员可随时退出；刷新和换 Frame 后状态一致 | 协作视口 |
| WS-02 | P0 | ready | 主持人冻结编辑、隐藏阶段内容并统一揭晓；冻结由服务端拒绝写操作实现 | 权限模型 |
| WS-03 | P0 | in_progress | 匿名/实名投票、额度、倒计时和结果揭晓；断线不重复计票，揭晓前不泄露统计 | Workshop API |
| WS-04 | P1 | ready | 工作坊步骤绑定说明、Frame、计时器和权限；换主持人后可继续、回退、跳过、结束 | WS-01/02 |
| WS-05 | P0 | ready | 至少 12 个模板：头脑风暴、亲和图、回顾、用户旅程、SWOT、优先级矩阵等 | Frame 语义 |
| WS-06 | P1 | ready | 组织将白板发布为版本化模板；新版本不改变既有实例，可归档并查看来源 | 模板治理 |
| WS-07 | P1 | in_progress | 评论支持回复、@成员、解决和转任务；对象删除后仍保留上下文与审计 | 评论/任务 |
| WS-08 | P1 | ready | 首次用户 3 分钟引导；5 名新用户至少 4 名独立完成新建、邀请、投票和分享 | UX/WS |

## D. Miro 与 Mural 迁移（15 分）

迁移采用统一中间模型和两阶段提交。结构化 API 导入与 PDF/PNG 视觉归档在产品中明确区分，不把静态截图称为可编辑迁移。Miro `.rtb` 是专有备份格式，不作为未经官方契约支持的解析入口。Mural Public API 的 widgets 列表明确不包含 drawings，必须报告该缺口并提供视觉底稿兜底。

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| MIG-01 | P0 | in_progress | 上传版本化 Miro REST/Mural Public API JSON 快照；转换 sticky/text/shape/frame/area/connector，预览后创建新 Board | #4013、portable import |
| MIG-02 | P0 | ready | OAuth 连接 Miro/Mural 并列出当前授权用户可访问白板；使用最小只读 scope，撤销立即失效 | 凭据保险库 |
| MIG-03 | P0 | ready | Miro 分页抓取 board/items；处理 cursor、429、超时和 10k 上限，黄金 fixture 覆盖支持类型 | MIG-02 |
| MIG-04 | P0 | ready | Mural 分页抓取 mural/widgets/files/tags；处理 next token、刷新 token 与 drawings 缺口 | MIG-02 |
| MIG-05 | P0 | in_progress | 两种来源归一为统一对象；保留 source provider/board/object、几何、样式、父级、连接和原始类型 | MIG-01/03/04 |
| MIG-06 | P0 | in_progress | 预览按完整、近似、降级、跳过统计；每个损失项有 code、count、sample source IDs，零静默丢失 | MIG-05 |
| MIG-07 | P0 | in_progress | 确认后原子创建新 Board；失败不留半成品，requestId 重试不重复，原板不改变 | #3998 |
| MIG-08 | P0 | ready | 图片/附件转存组织资产库；MIME/大小/超时校验、SHA-256 去重，失败显示占位和报告 | 资产治理 |
| MIG-09 | P1 | ready | Frame/Area、演示顺序、标签和评论尽量保留；作者显示名与源时间有 provenance | MIG-05/08 |
| MIG-10 | P1 | ready | 未支持对象以可见 placeholder 或视觉底稿保留，用户可查看原因和原始来源 | MIG-06/08 |
| MIG-11 | P1 | ready | 批量迁移可暂停、恢复、取消、失败重跑；单板失败不阻塞队列，进度可审计 | MIG-07 |
| MIG-12 | P0 | ready | Mural sticky CSV 生成可编辑便签；PDF/PNG 作为锁定视觉背景，明确标记不可编辑 | 文件资产 |
| MIG-13 | P0 | ready | 每家 small/medium/large 黄金板自动比较；语义保留率 ≥95%，层级/连接 100%，无未报告损失 | MIG-01–12 |

官方契约基线：

- Miro `GET /v2/boards/{board_id}/items` 与 `boards:read`：https://developers.miro.com/reference/get-items-experimental
- Miro `.rtb` 备份的产品边界：https://help.miro.com/hc/en-us/articles/360017572774-How-to-save-board-backup
- Mural widgets API（不含 drawings）：https://developers.mural.co/public/reference/getmuralwidgets
- Mural PDF export：https://developers.mural.co/public/reference/exportmural

## E. 无障碍与移动端（10 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| A11Y-01 | P0 | ready | 新建、编辑、多选、移动、连接、评论、投票全程可仅用键盘完成；焦点可见且无陷阱 | UX/WS |
| A11Y-02 | P0 | ready | 屏幕阅读器可通过对象列表/Frame 大纲读取类型、文本、父级、位置和选中状态 | Frame 语义 |
| A11Y-03 | P0 | ready | axe 无 serious/critical；颜色对比、200% 缩放、减少动画满足 WCAG 2.2 AA | UI 完成 |
| MOB-01 | P0 | ready | 手机/平板支持单指选择、双指缩放、长按菜单和手写笔，不与页面滚动冲突 | Pointer 手势 |
| MOB-02 | P1 | in_progress | 375/768/1280 全屏可用；工具栏可收起，软键盘不遮挡编辑，旋转后视口保持 | MOB-01 |

## F. 性能与自托管运维（12 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| PERF-01 | P0 | in_progress | 10k 对象参考设备可交互时间 ≤3 秒，平移缩放 p95 ≥45 FPS，DOM 数量由视口约束 | 虚拟渲染 |
| PERF-02 | P1 | ready | 50k 对象按区域/Frame 分片，内存 ≤500MB，跳转不需全量渲染 | 空间索引 |
| OPS-01 | P0 | in_progress | 自托管指标覆盖连接数、更新延迟、拒绝、队列、快照、存储；告警有处理手册 | operations |
| OPS-02 | P0 | ready | 备份恢复演练达到 RPO ≤5 分钟、RTO ≤30 分钟，ACL/Yjs/资产/历史一致 | 部署 |
| OPS-03 | P1 | ready | 容量、保留期、对象上限和附件策略可配置；超限前有用户可见预警 | OPS-01 |

## G. AI、开放 API 与扩展（10 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| API-01 | P0 | in_progress | OpenAPI/SDK 示例完成创建 Board、批量对象、成员、导入导出；契约版本化且权限与 UI 一致 | Public API |
| API-02 | P1 | ready | Board webhook 有签名、重放防护、退避、死信和审计 | API-01 |
| EXT-01 | P1 | ready | 开源插件注册对象和导入器；schema 有版本/大小/权限限制，未知扩展可安全保存和导出 | extension |
| AI-01 | P0 | in_progress | AI 以可见参与者身份提交 proposal；人类逐项/批量接受或拒绝，来源和版本可审计 | AI proposal |
| AI-02 | P1 | ready | 多 Agent 可在不同 Frame 并行；权限、选区、状态、预算可见，冲突进入提案队列 | AI-01 |
| AI-03 | P0 | in_progress | Chat 中当前可渲染 Mermaid/Fabric 图形可插入 Board，保留布局、连接和来源并可协作编辑 | #4005 |

## H. 会议室（6 分）

| ID | 优先级 | 状态 | 用户可见行为与完成验收 | 依赖 |
| --- | --- | --- | --- | --- |
| ROOM-01 | P0 | in_progress | 一次性码配对指定 Board；跨租户不可探测，撤销立即生效，退出后清空前一 Board 内容 | #4000 |
| ROOM-02 | P1 | in_progress | 演示者控制 Frame 与大屏跟随；Esc 退出、断线恢复，大屏始终只读，30 分钟无漂移 | WS-01 |
| ROOM-03 | P1 | ready | 会议室设备独立身份、会期和审计；扫码参与者使用个人身份，不共享设备权限 | 身份域 |

## 建议交付顺序

1. **迁移可见切片**：MIG-01/05/06/07（issue #4013），先让用户可以导入两家官方 API JSON 快照，并得到可解释报告。
2. **便利贴效率**：UX-01–07 与 A11Y-01，补齐日常输入、批量整理和键盘路径。
3. **直接迁移**：MIG-02–04、08–13 与 API-01，完成 OAuth、资产、文件兜底、批量与质量门。
4. **主持闭环**：WS-01–08、ROOM-02，使主持人能独立完成标准工作坊。
5. **可靠性门**：COL、移动端、无障碍、性能、备份恢复全部达到硬指标。
6. **扩展与试点**：AI、多 Agent、Webhook、插件；完成真实迁移、真实会议和两周组织试点。

## 最终验收包

最终验收证据必须包含：计分表、每项 issue/PR/SHA、自动化命令输出、small/medium/large 迁移差异报告、50 人协作报告、WCAG 报告、10k/50k 性能报告、备份恢复记录、会议室 30 分钟记录、真实 10 人工作坊观察表和两周试点回退日志。缺少其中任一硬门材料时，最高仍为 8.x，不得声明 9 分。
