# 导入导出、开放 API 与内容存储

> 元数据：估点 **16**（与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。

## R1 用例
组织把 Miro/Mural 现有 Board 迁入 WorkspaceX，通过开放 API 操作 Board，并将大内容保存在文件/对象存储。

## R2 前置与触发
用户有导入/导出或 API scope；提供官方导出包、授权连接、标准文件或 API 请求时触发。

## R3 主流程
1. 导入原件先写隔离 blob，计算 hash、扫描和解析；生成对象/连接/Frame/样式映射预览。
2. 用户确认后，导入器以普通批量 operations 写入 Y.Doc；完成页给出总数、成功、降级、跳过、失败及逐项原因。
3. 支持 Miro 与 Mural 的 Sticky、Text、Shape、Image、Connector、Frame/Area、Group 基础映射，保留来源 id/provenance 供核对和幂等重试。
4. 开放 API 以版本化 schema 创建、读取、批量修改、导入/导出和订阅事件，并执行与 UI 相同的 ACL/幂等/限流。
5. PG 只保存 Board 元数据、ACL、索引、version/blob pointers、审计引用；Yjs snapshots/segments、导入原件、导出包和媒体保存在文件/对象存储。
6. 内容 blob 采用 content hash、原子 pointer 更新、加密、租户隔离、保留/GC 和可恢复备份。

## R4 备选与异常
- A1：离线导出包与 OAuth 拉取两种导入方式共用映射报告。
- A2：文件系统 backend 用于本地/自托管，对象存储用于 Hosted；契约和 hash 相同。
- E1：压缩炸弹、路径穿越、恶意 SVG/HTML、超限文件在解析前拒绝并审计。
- E2：未知/不支持对象保留原始记录并明确降级，不能静默丢失。
- E3：内容上传成功但 PG pointer 事务失败时保持不可见临时 blob 并由 GC 清理；不得留下悬空正式版本。
- E4：blob 缺失/损坏时拒绝返回空板，尝试已验证副本并发出恢复告警。
- E5：OAuth 断开必须调用官方固定 revoke endpoint；凭据仅发往配置允许的官方 host，日志不泄漏 token/secret。

## R5 权限
只有授权 Owner/Editor 或 scoped API client 可导入/修改；导出、原件下载、blob URL 与 webhook 分别校验 ACL；跨租户 hash 去重不能泄漏存在性。

## R6 后置与不包含
迁移结果可核对、可重试、可编辑；内容与元数据引用一致。本轮不承诺每种供应商私有 widget 的像素级可编辑语义。

## R7 业务规则
- Fabric JSON 永不成为交换或存储格式；外部数据先规范化为领域 schema/operations。
- 导入幂等由 source board id + source object id + source revision/manifest hash 决定。
- 删除内容遵守 retention/legal hold；GC 只清理不可达且超过安全窗口的 blob。

## R8 界面线索
导入向导含来源、扫描、预览、确认、进度、报告；导出和 API token 管理提供权限/过期提示。

## R9 非功能约束
支持大文件流式处理、背压和取消；blob 加密、签名 URL 短时有效；敏感日志字段白名单；自托管文件路径不可由用户控制。

## R10 依赖
Board API、Miro/Mural adapter、对象存储/文件 backend、PG metadata、KMS、malware/content scanner。

## R11 切分
第 7 轮：storage contract、public API、Miro、Mural、export、GC/backup；三块脱敏真实供应商 Board 用于第 10 轮收口。

## R12 验收线索
三块真实 Board 逐对象计数/hash/截图核对；Hosted SQL 体积不随 Yjs 更新正文线性膨胀；故障注入覆盖 upload/pointer/GC/restore；API conformance 与跨租户拒绝通过。
