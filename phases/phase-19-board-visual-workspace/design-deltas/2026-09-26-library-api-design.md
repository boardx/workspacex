# Board Library 标签与 Duplicate 候选 API 设计

关联：[浏览页与底部 dock 设计增量](./2026-09-26-library-bottom-dock.md)、[正式集成验收矩阵](./2026-09-26-workspace-acceptance-matrix.md)、[内容存储接入验收](./2026-09-26-storage-integration-acceptance.md)、[issue #4217](https://github.com/boardx/workspacex/issues/4217)、[设计 PR #4218](https://github.com/boardx/workspacex/pull/4218)。

本文把预览中的标签、组合筛选和 Duplicate 转成可审查的 API 候选。它不是已签核契约，也不修改 `packages/contracts/src/whiteboard.ts`、数据库 schema、`feature_list.json` 或任何 `design-signoff.md`。正式实现前，候选形状必须进入 Phase 19 对应契约束，经 UI、用例、API 三件签核和一致性复核后，才可物化为 Zod 单一事实源。

同目录材料分工如下：浏览页可见行为和人类意图由 `2026-09-26-library-bottom-dock.md` 负责；正式路由和既有 CRUD 验收由 `2026-09-26-workspace-acceptance-matrix.md` 负责；Yjs 内容文件、pointer、迁移和恢复由 `2026-09-26-storage-integration-acceptance.md` 负责；本文只定义标签与 Duplicate 的候选 API 差异，避免复制其他材料的权威内容。

## 1. 已存在且必须复用的正式事实

本节绑定 PR #4212 exact SHA `aa35c58ebe69476765b02c60f0f9950c368e9c2f`。本地 branch/ref 的存在不代表已合入，主 session 仍需读取 PR 和 CI 实时状态。

| 已有能力 | `packages/contracts/src/whiteboard.ts` / 正式实现事实 | 本候选处理 |
|---|---|---|
| `Board` | `id`、`name`、`ownerId`、`role`、`archived`、`createdAt`、`updatedAt` | 只建议增加标签引用字段；不重造 Board DTO |
| `listBoards` | `GET /whiteboards`，输入为空，输出 `{items}`；repository 按 `updated_at DESC, id`，最多 500 条 | 扩展同一操作的 query 与 cursor 输出，不新增平行 search/list API |
| `createBoard` | `POST /whiteboards`，输入 `{requestId,name}`；唯一键 `(org_id,owner_id,request_id)`，并发重试返回同一 Board | 原样复用；Duplicate 使用独立 requestId receipt，不拿 create 模拟内容复制 |
| `getBoard` | `GET /whiteboards/:boardId` | 原样复用；返回扩展后的同一 Board DTO |
| `updateBoard` | `PATCH /whiteboards/:boardId`，当前修改 `name`/`archived` | 扩展为可设置完整 tag ID 集合；不另造单 Board 标签 patch API |
| 成员管理 | Owner 可 list/put/remove；只允许同组织成员；Owner 身份不可通过 member API 改写 | Duplicate 不复制成员行；标签不能扩大 Board ACL |
| 可见性 | Owner 或 `whiteboard_members` 中的 Editor/Viewer 可 list/get；跨租户与无权 ID 不可见 | 所有新读写先执行同一租户与 Board 可见性判断 |
| 元数据管理 | PR #4212 repository 只允许 Owner update Board 或管理成员；Editor/Viewer 只读元数据 | Board 标签绑定沿用 Owner-only；如要放宽必须单独签核 |
| 新建默认权限 | Board private-by-default，创建者为 Owner，成员为空 | Duplicate 目标同样 private-by-default，绝不继承源成员 |

现有 `createBoard` 的 requestId receipt 没有 payload hash 冲突语义；本候选不借机改变它。新增标签创建和 Duplicate 应从第一版保存 request hash：同一主体、同一 requestId、同一 payload 返回同一结果；同 requestId 不同 payload 返回稳定 `IDEMPOTENCY_CONFLICT`，不能静默复用旧结果。

## 2. 候选领域字段

### 2.1 标签目录

标签是组织内稳定身份，不是写进 Board 名称或 Yjs 文档的字符串：

| 候选类型 | 字段 | 不变量 |
|---|---|---|
| `BoardTagId` | UUID | 创建后永不改变、删除后不复用 |
| `BoardTag` | `id`、`name`、`revision`、`createdBy`、`createdAt`、`updatedAt` | `name` trim 后 1–40 字符；组织内按签核后的 Unicode/case-fold 规则唯一；rename 只改名称和 revision |
| Board 增量 | `tagIds: BoardTagId[]`、`tagsRevision: integer` | `tagIds` 是集合，响应按 ID 规范排序；只引用同组织未删除标签；标签名称只从目录解析 |

不把 tag name 复制到每一行 Board。rename 保持 ID 与所有引用不变；UI 用一次 `listBoardTags` 的目录结果渲染名称。标签响应不返回全组织 Board 数量，避免通过标签计数侧信道推测调用者无权访问的 Board。

建议标签目录采用逻辑删除/tombstone，外部表现为删除后不再列出。删除在一个 PG 事务中让 tag 不可选并解除全部 Board 绑定，但不删除、归档或改写任何 Board 内容；旧 ID 永不复活。是否允许之后以新 ID 重新创建同名标签，由名称唯一性策略签核，不能复用旧 ID。

### 2.2 Duplicate receipt 与来源版本

候选 `DuplicateBoardInput`：

| 字段 | 约束 | 作用 |
|---|---|---|
| `requestId` | UUID，调用者作用域内幂等 | 不确定响应重试只产生一个目标 Board |
| `targetName` | 复用现有 `Board.name` schema | UI 可以预填“源名称 + 副本”，服务端不内置语言相关后缀 |
| `expectedSource` | 可选 `{epoch, seq}` | 编辑器内复制可要求精确复制已看到的 durable head；浏览卡片未打开时省略，由服务端围栏捕获最新 durable head |

候选输出复用 `Board`，并增加只读复制 receipt：`sourceBoardId`、实际捕获的 `sourceEpoch`/`sourceSeq`、`objectCount`、`connectorCount`、`assetCount`。receipt 记录核对信息，不返回 source ACL、对象正文或内部 blob key。

重试必须返回同一个目标 Board 和同一个 captured source version。省略 `expectedSource` 不表示每次重试重新取“最新”；第一次接纳后，request receipt 已锁定来源版本与目标 ID。

## 3. 候选操作差异

下面是签核用形状说明，不是第二份运行时 schema。签核通过后只在 `packages/contracts/src/whiteboard.ts` 物化一次，并由前端 client、controller、OpenAPI 和 mock 共同消费。

| 操作 | 方法与路径 | 候选输入 | 候选输出 / 语义 |
|---|---|---|---|
| 扩展 `listBoards` | `GET /whiteboards` | `cursor?`、`limit?`、`query?`、`tagIds?`、`archived?` | `{items: Board[], nextCursor: string|null}`；query 与全部 tagIds 同时满足；仍只返回当前主体可见 Board |
| `listBoardTags` | `GET /whiteboard-tags` | 无，或后续签核的 cursor | `{items: BoardTag[]}`；只列本组织未删除标签，不含未授权 Board 计数 |
| `createBoardTag` | `POST /whiteboard-tags` | `{requestId,name}` | 创建或重放同一 tag；重名返回 `TAG_NAME_CONFLICT` |
| `renameBoardTag` | `PATCH /whiteboard-tags/:tagId` | `{requestId,name,expectedRevision}` | ID 和 Board bindings 不变；revision CAS，冲突返回 `REVISION_CONFLICT` |
| `deleteBoardTag` | `DELETE /whiteboard-tags/:tagId` | `{requestId,expectedRevision}` | 同事务 tombstone tag 并解除所有引用；Board/内容不删除；重放返回原 receipt |
| 扩展 `updateBoard` | `PATCH /whiteboards/:boardId` | 现有字段，另可带成对的 `tagIds` + `expectedTagsRevision` | Owner-only；用完整目标集合替换 bindings；revision CAS，避免两个标签编辑器互相覆盖 |
| `duplicateBoard` | `POST /whiteboards/:boardId/duplicates` | `DuplicateBoardInput` | 完整复制成功后返回新 Board + receipt；失败不出现可见的半成品 Board |

`UpdateBoard` 的校验建议增加：`tagIds` 与 `expectedTagsRevision` 必须同时存在或同时省略；ID 去重；所有 tag 必须在当前组织且未删除。现有 name/archived 行为不变。设置完整集合是幂等 desired-state 操作，revision 负责检测并发覆盖，不需要再创建 `addTag`/`removeTag` 两套边缘 API。

## 4. 列表分页、搜索与 AND 标签过滤

### 4.1 组合规则

- `query` 只搜索 Board name；trim 后空字符串视为未提供，最大长度复用签核后的搜索输入限制。
- `tagIds=[A,B]` 表示 Board 同时绑定 A **且** B。空数组等价于无标签条件；重复 ID 在解析时去重。
- `query`、`tagIds`、`archived` 与既有 ACL 使用 AND；标签匹配从不让不可见 Board 进入结果。
- 任一 tag ID 不存在、已删除或不属当前组织时返回稳定 `TAG_NOT_FOUND`，不把它解释成“零结果”。
- 默认排序继续复用 `updatedAt DESC, id`，避免 UI 与 API 产生第二套顺序。

### 4.2 cursor

cursor 是服务端签名/认证的 opaque token，至少绑定租户、主体、规范化 query、去重排序后的 tagIds、archived、page limit、首次请求时间和最后一项的 `(updatedAt,id)`。客户端不得拼装 cursor；后续请求改变任一筛选字段返回 `CURSOR_FILTER_MISMATCH`。

使用 keyset pagination，不使用 offset。ACL 每页重新计算，成员被撤销后下一页不能继续泄漏 Board。该候选不承诺跨多个 HTTP 请求的数据库快照隔离：分页期间创建或更新 Board 可能改变排序位置，客户端按 Board ID 去重，并在完成批次或收到 mutation 后刷新第一页。主 session 的确定性分页测试应冻结数据集；并发变化另按第 7 节验收，不能把 eventual list 宣称为 snapshot list。

limit 必须有保守默认值和服务端上限；具体数字在正式 Zod/runtime 配置中单点定义，本文不复制第二组容量常量。

## 5. 标签写入与删除一致性

标签目录和 Board bindings 全部受 tenant RLS。候选授权建议：

- 任一当前组织成员可列标签。
- Board 标签绑定继续复用 `updateBoard` 的 Owner-only 元数据权限。
- 创建标签允许当前组织成员；rename/delete 允许标签创建者或组织管理员。该治理规则仍需人类裁决，见第 9 节。

rename 以 `expectedRevision` CAS；同时发出的两个 rename 最多一个成功。因为 Board 只保存 tag ID，成功 rename 无需重写 bindings，所有可见 Board 在下一次目录读取后显示新名称。

delete、set Board tags 和 Duplicate 捕获 tag bindings 必须按固定锁序列化 tag rows 与 Board row：

- delete 先提交：后续 set/duplicate 不得引用该 tag，返回 `TAG_NOT_FOUND` 或复制不包含已删除 tag。
- set/duplicate 先提交：delete 随后在同一组织事务中解除源和目标的所有 bindings。
- 任一可见终态都没有 dangling tag ID；删除标签不更改 Board `archived`、name、Yjs 内容或 ACL。

过滤请求携带已删除 tag 时返回 `TAG_NOT_FOUND`，UI 移除该筛选并刷新；不能用旧名称或旧 ID 重新创建一个隐式标签。

## 6. Duplicate 一致性和引用重映射

### 6.1 捕获一个明确来源版本

Duplicate application use case 先执行与正式 Board load 相同的 tenant/ACL 检查，再取得 Board writer/leader fence 或等价行锁，捕获 authoritative `(epoch,seq,manifest pointer/fencing token)`；legacy PG 期间捕获同一事务里的 snapshot/seq。提供 `expectedSource` 时不一致即返回 `SOURCE_VERSION_CHANGED`，不擅自复制别的版本。同一捕获事务分配 hidden target ID、持久 request receipt，并在固定锁序下复制当时有效的 tag bindings；目标在内容发布完成前不参与普通 list/get。这样，后续 tag delete 仍能从隐藏目标解绑，而 Duplicate 不需要在长时间内容转换期间持有 tag row lock。

捕获后的 immutable manifest/checkpoint 可在锁外读取和转换；源 Board 后续写入不进入本次副本。目标对外可见前再次检查调用者仍有源访问权、资产复制权和目标创建权，并验证目标 Y.Doc 与 receipt 的 source epoch/seq 一致。权限被撤销或校验失败时，隐藏目标进入受控清理，不出现在 `listBoards`。

未打开过的 Board 也从服务端 authoritative content head 复制；不能依赖浏览器 `drafts`、Fabric JSON 或组件是否访问过该 Board。

### 6.2 新身份与内部引用

目标使用新的 Board ID。复制器先建立完整、确定性的 `sourceObjectId -> targetObjectId` map，再写目标文档：

- Sticky、Text、Shape、Image、Frame/Area、Group、Draw 等每个领域对象得到新的 object ID。
- Connector 自身得到新 ID；`sourceObjectId`、`targetObjectId`、anchor/binding 和 group/frame member refs 只能指向 target map 中的新 ID。
- 不允许任何目标引用回源 Board 的 object ID。源中已合法处于 detached/tombstoned 状态的 connector 按领域契约保持 detached，不能猜一个端点。
- mapping 由 copy receipt/job 持久化或可确定重建；相同 requestId 重试不产生第二套 ID。
- Undo/Redo 历史、presence、selection、awareness、在线成员和协作 session 不复制；来源审计只记录 source Board/version 引用，不冒充目标编辑历史。

复制完成后分别修改源和目标，Yjs 更新、object IDs、connector refs 与后续 Undo 都不能串板。

### 6.3 资产与权限

资产 bytes 可以在同租户内复用不可变内容地址，但必须为目标创建新的 asset binding/reference，并在每次读取时按目标 Board ACL 鉴权。不得复制源的短期 signed URL、成员 ACL、外部 token 或跨租户 asset reference。

候选默认采用 all-or-nothing：任何 Image/附件缺失、损坏、不可复制或调用者缺少复制权，整个 Duplicate 在目标可见前失败并返回稳定 `ASSET_COPY_FORBIDDEN`、`ASSET_MISSING` 或 `COPY_INTEGRITY_FAILED`；不静默产生缺图副本。若产品需要降级复制，必须另行签核逐项报告和用户确认，不能由实现自行跳过。

### 6.4 目标默认权限

目标 Board 的 owner 是调用者，members 为空；不复制源 Owner、Editor、Viewer、邀请链接、历史、presence 或 API grants。复制 tags 只复制捕获时仍有效的稳定 tag IDs。新目标只有在元数据、完整 canonical Yjs 内容、connector remap、asset bindings 和标签 bindings 全部提交并验证后才进入 list/get 可见状态。

## 7. 失败与并发矩阵

| 场景 | 候选结果 |
|---|---|
| 同一 Duplicate requestId 并发/超时重试 | 返回同一 target Board 和同一 captured source version；只存在一份 object map |
| 同一 requestId 改 targetName/source choice | `IDEMPOTENCY_CONFLICT`，原副本不被改名或重做 |
| Duplicate 捕获时源 Board 继续编辑 | 副本固定在 captured epoch/seq；之后 ACK 的源更新不进入目标 |
| `expectedSource` 已过期 | `SOURCE_VERSION_CHANGED`；无目标卡片、无部分 bindings |
| 源权限在转换中被撤销 | 发布前复核失败；对调用者按既有 non-disclosure 规则返回不可访问，隐藏目标清理 |
| Viewer 请求 Duplicate | 按推荐权限拒绝且不创建目标；最终是否允许由第 9 节签核 |
| 目标写入/存储/asset binding 中途失败 | `COPY_INTEGRITY_FAILED` 或稳定基础设施错误；list/get 不出现半成品，request receipt 可安全重试/恢复 |
| 同源两个不同 requestId | 两个独立目标，各自新 Board/object IDs；这是两个用户意图，不去重 |
| tag rename 与 list/filter 并发 | ID 和 bindings 不变；筛选语义不变，下一次目录读取显示新名称 |
| 两个 rename 使用同 revision | 一个 CAS 成功，另一个 `REVISION_CONFLICT` 并重新读取 |
| tag delete 与 Board tag set 并发 | 固定锁序列得到“先绑定后解除”或“先删除后拒绝”，无 dangling ID |
| tag delete 与 Duplicate 并发 | delete 先提交则副本不含该 tag；copy binding 先提交则 delete 从源/目标一并解除 |
| 两个标签编辑器覆盖同一 Board | `expectedTagsRevision` 只允许一个集合替换，另一个 `REVISION_CONFLICT` |
| list 分页期间 ACL 被撤销 | 下一页重新鉴权且不泄漏；cursor 不能绕过当前 ACL |
| cursor 与不同 query/tagIds/主体重用 | `CURSOR_FILTER_MISMATCH` 或不可用 cursor；不返回其他筛选/主体的数据 |
| asset 权限在复制中被撤销 | 发布前复核失败，目标保持不可见；不留下可被目标 ACL 读取的越权 binding |

错误响应应进入正式 Whiteboard error contract，而不是只靠 HTTP 文案。既有不可见 Board 与 missing Board 的非披露语义保持一致；validation 为 400，revision/idempotency/source-version conflict 为 409，基础设施失败可重试但不能返回成功 Board。

## 8. 主 session 验收矩阵

以下均在最终实现 exact SHA 上执行；当前预览测试只证明页面内行为，不能替代 API、PG、Yjs、asset 或 ACL 证据。

| 链路 | 操作 | 必须观察的结果 | 主 session 证据 |
|---|---|---|---|
| 现有 CRUD 未回归 | create/list/get/update name/archive/restore 与成员授予/撤销 | 路由和权限保持 PR #4212 语义；新字段不产生第二套 Board DTO | contract parse、HTTP、真实 PG 测试 |
| 分页 | 创建超过一页的稳定数据集，按 cursor 遍历 | 无重复/遗漏；nextCursor 终止；limit 上限生效 | 请求/响应序列与 ID 集合 |
| AND + search | 两标签、名称 query、archived 与 ACL 组合 | 只返回同时满足全部条件且可见的 Boards | SQL/HTTP 对照、跨角色列表 |
| cursor 绑定 | 用不同筛选、不同组织和不同用户重放 cursor | 明确拒绝且不泄漏任何 Board | 错误码和跨租户断言 |
| tag create retry | 丢弃成功响应，用同 requestId 重试；再改 payload 重试 | 同 payload 返回同 tag；不同 payload `IDEMPOTENCY_CONFLICT` | receipt、tag 行数、响应 ID |
| tag rename | 同一 ID rename，并在多个 Board/筛选中回读 | 所有引用保持，名称同步，Board rows 不复制旧名称 | tag revision、bindings、UI/API 回读 |
| tag rename CAS | 两请求使用同 expectedRevision | 一个成功、一个 409；无丢失更新 | 并发请求和最终 row |
| tag delete | 删除被多 Board 使用的 tag | tag 不再列出，所有 bindings 原子解除；Boards、内容和 ACL 不变 | 事务前后表、Board/Yjs hash |
| Board tag revision | 两客户端基于同 tagsRevision 保存不同集合 | 一个成功，另一个冲突并能刷新重试 | HTTP 409、最终集合与 revision |
| 未打开源 Board Duplicate | 不打开编辑器直接复制有内容 Board | 目标包含服务端完整内容和 tags；不依赖浏览器 draft | source/target Yjs 对象计数和 captured seq |
| 已编辑源 Board Duplicate | 等待一批写 ACK 后复制，同时继续编辑源 | 目标只含 captured seq；后续源写不出现；两边继续编辑互不影响 | ACK/head、双向 Yjs diff、两 Board 回读 |
| Duplicate 不确定响应 | 服务端完成后丢响应，用同 requestId 重试 | 仅一个目标 Board、相同 target ID/object map/source seq | receipt、Board 数量、对象 IDs |
| Duplicate payload conflict | 同 requestId 改名称或 source version | 稳定 409；原目标保持不变 | 两请求与目标回读 |
| object/connector remap | 源含对象、connector、frame/group 与 detached connector | 所有有效 refs 指向目标新 ID；无 source object ID 泄漏；detached 语义保持 | source-target map、领域校验、画布回读 |
| asset ACL | 源含可复制和不可复制资产；并发撤销权限 | 全部可复制时目标 binding 只受目标 ACL；任一失败时无可见半成品 | asset rows/blob refs、角色读取、失败清理 |
| 默认权限 | Owner/Editor 执行 Duplicate，随后源成员访问目标 | 调用者为目标 Owner，成员为空；源成员看不到目标，除非目标 Owner 另行授权 | member rows、Owner/Editor/Viewer/跨租户 HTTP |
| publish 前撤权 | 转换期间撤销源 Board 或 asset 权限 | Duplicate 不发布目标；重试不越权 | fence/ACL trace、list/get 结果 |
| tag delete 与 copy 交错 | 控制两种锁顺序 | 结果符合第 7 节且无 dangling bindings | transaction trace、bindings 完整性 |
| 失败恢复 | 在 snapshot read、transform、content publish、metadata publish 各点注入失败 | 不出现空白/部分目标；同 request 可恢复或返回稳定终态 | 故障注入、hidden job/receipt、list/get |

## 9. 人类签核所需的最小决策

### D1：谁可以 Duplicate？

- **A（建议）**：源 Board Owner/Editor 可复制，Viewer 不可复制。理由：Duplicate 是内容导出并创建可编辑副本，权限高于只读查看。
- B：任何可读主体都可复制。体验更宽松，但 Viewer 可把受控只读内容变成自己可编辑且可再分享的副本。

无论选择哪项，目标都 private-by-default，不继承源成员。

### D2：组织标签由谁治理？

- **A（建议）**：当前组织成员可创建；tag creator 或组织管理员可 rename/delete；Board bindings 仍由对应 Board Owner 修改。兼顾自助与全组织影响控制。
- B：只有组织管理员可 create/rename/delete；Board Owner 只能绑定。治理更严，但普通团队要等待管理员建标签。

两项都保持标签组织级、稳定 ID、rename 不改引用、delete 全局解绑且不删除 Board。

### D3：标签删除保存 tombstone 还是立即物理删除？

- **A（建议）**：事务内 tombstone + 全局解绑，外部立即不可见；retention 后物理回收。可支持幂等 receipt、审计和并发诊断，旧 ID 永不复用。
- B：事务内硬删除 tag 与 bindings。实现更短，但不利于不确定响应重放、审计与问题恢复。

### D4：不可复制资产如何处理？

- **A（建议）**：all-or-nothing，目标可见前整体失败。符合“完整内容副本”，不会静默丢图。
- B：允许降级，但必须新增逐项报告和用户确认契约；不能在本候选下直接实现。

除以上四项外，复用既有 list/create/get/update、AND 过滤、稳定 tag ID、精确 source seq、对象/connector 全量 remap、目标默认私有和不复制成员均可直接进入契约束审查，无需再扩大 backlog。

## 10. 当前缺失证据

本次只新增候选设计文档，没有修改或执行 contract、controller、repository、migration、Yjs copier、asset binding 或前端 client；没有运行浏览器、Docker、API、PG、WebSocket 或 E2E；没有读取 GitHub 当前 checks。当前也没有已签核的标签/复制 API、tag schema、copy receipt、对象 remap、asset ACL 复制器或上述并发/失败测试。因此本文帮助人类收敛签核，不构成实现或通过声明。
