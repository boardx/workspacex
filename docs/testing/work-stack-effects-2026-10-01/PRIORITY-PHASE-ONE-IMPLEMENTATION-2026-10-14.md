# 数字人第一阶段优先交付实施记录

用户在 2026-10-13 23:58 UTC 确认本优先批，并授权本任务跳过 Agent 注册。本次不修改全局规则、不创建或冒用身份/凭据、不调用需其身份的协调接口，不合并、不部署生产。

## 已确认的范围

- 数字人：D001, D002, D003, D004, D005, D006, D007, D008, D009, D010
- Workflow：W001, W002, W003, W004, W005, W006, W007, W008, W009, W010, W011, W012, W013, W014, W015, W016, W017, W018, W027, W029
- 优先 Skill：S003, S005, S006, S007, S009, S010, S011, S012, S014, S015, S016, S017, S019, S020, S021, S022, S023, S024, S025, S026, S027, S028, S029, S030, S031, S032, S033, S034, S035, S036, S045, S061, S062, S063, S064, S065, S067, S068, S102, S142, S143, S154, S155, S162, S171, S187, S189, S190, S193, S197

依赖源：requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md、WORKFLOW-SKILL-MATRIX.md、各实体作者化文档。该批为 10/20/50 优先交付，不能当作 D001–D010 的完整能力闭包（完整闭包 10/53/151）。其他关系保留待实现，D011 与已有非优先 Workflow 不删除。#4922 的旧 4/19/58 记录保留历史意义，不作为本批最终分母。本文是实施记录，不覆盖功能清单状态。

## 当前实施：W027（第一项修复，尚未完整验收）

- main@3dcaebdf6 的历史 W027 实质输出反证失败，其余九条同类门也失败。技术测试或文档 PASS 不代表业务完成。
- 旧 W027 v1 图不再返回元数据假成功；其定义及固定 Skill 版本保留。无内容执行器明确失败。
- 新 v2 为每个生成阶段增加后置审批节点。审批预览读已提交阶段产出，绑定服务器计算的 payload digest；生成前不能批准尚不存在的正文。
- 精确冻结六个参与 Skill 为 1.2.0。新不可变 work-discovery-execution@1.2.0 包封装已独立作者化的 v2 方法全文；旧包不变。新包没有新增 Verified 声明，导入/发布与专业质量评测须独立验证。
- 执行器读取同组织、相同 Workflow/定义版本实例和前序产出，拒绝缺失/重复 pins、跨组织、空/元数据输出；边界 schema 与判据摘要校验拦截不合格内容。
- 新版本的提纲导入、田野声明必须有真实平台适配器，未接线明确失败；所有写入经过 effect-gateway 和审批摘要比对。
- 发布桥物化真实 Markdown/provenance 文件、回读校验 hash 后记录版本；通过现有实例产出 API 和查看页读取探索结果，展示探索级证据限制。

## 验收边界与下一步

本提交仍不足以声明 W027 完成：提纲导入/田野适配器未接入生产合成，业务不变式尚未全量实现（RQ-test 映射、同意撤回、分层覆盖、双签、项目写入授权与绑定、停止/转向/补证据及第二轮等）。模型端口使用确定性结果的测试只能证明接线与运行纪律，不能证明真实模型专业质量。

其余 19 个优先 Workflow（含 W029 既有实现的复核）、其余 44 项新方法执行验收、D001–D010 完整逐角色用例、画布/PDF/PPT/Word 的业务生成保存再打开仍未完成。保留逐项失败和未运行状态，不凭 PR 创建或 CI 通过关闭第一阶段任务。

## 执行计划

```mermaid
flowchart LR
 S1[范围确认与反证] --> S2[W027 第一项修复] --> S3[优先批剩余能力] --> S4[全批业务与产物验收] --> S5[Draft PR 与精确提交 CI]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class S1 tested
 class S2 doing
 class S3 todo
 class S4 todo
 class S5 doing
```

## 本轮实际验证

- `./init.sh` 快速路径：通过。
- `pnpm --dir apps/api run typecheck`、`pnpm --dir packages/contracts run typecheck`、`pnpm --dir apps/web run typecheck`：通过。
- `pnpm --dir apps/api run lint`、`pnpm --dir apps/web run lint`：通过。
- 新 W027 DB-free 专项：9/9 通过（固定作者化方法、输出边界、租户拒绝、实际文件保存/回读及产出 API）。
- W027 真 PostgreSQL/LangGraph 专项：2/2 通过（真实新包导入/固定正文读取、生成后审批、恢复不重复模型调用、拒绝零 effects）。
- 受影响目录/固定方法/W001/W029 回归：43/43 通过。
- 通用真 PG 审批/拒绝/恢复/副作用权限回归：24/24 通过。
- 前端产出查看页：6/6 通过。
- `build-discovery-execution-pack.ts --check`：通过，6 个精确 1.2.0 方法；SHA256 9672d8cb453afd4b61b6eda0fb1365bdaedee20853f2600d466d2ce2e2b86313。

以上 84 项为实际测试断言，不是 84 个已完成实体。W027 真库与单测均使用确定性模型端口；真实模型专业质量、完整 W027 发布旅程、四种格式完整业务验收未运行。所有本轮隔离栈由 with-test-isolation 清理。详细机器结果在本任务工作副本 acceptance/，原历史 acceptance/ 未覆盖。

## CI 反证与共享固定版本兼容修复

第一项提交 95c8d3db0 的 gates-test (2) 实测发现新探索包与既有 work-product/work-research 的正逆序导入冲突。修复仅允许本组织已有成功 starter-pack 导入血统、相同 Work stableId / stableName / 显示名的实体追加不同不可变版本；普通 Skill、自建/URL 导入或平台组织行不进入此路径。同版本不同正文仍拒绝，整包预检在任何版本写入前完成；跨包导入不恢复手动停用状态。版本分叉由 HTTP 409 可见返回，重放同一失败请求仍为 409。

真实模型测试因自动审批审查拒绝私有开发凭据的外部发送而未执行；域名核实和主机/重定向限制后仍被拒绝。按用户接管要求，助手不再读取或发送模型 API key、不重试认证命令。已准备本任务 acceptance/run-w027-real-model.ts，供用户本人本地终端执行一次合成 S061 调用；结果在用户回传前始终为未运行。脚本、命令与最小回传格式仅保留在本地 evidence，不把私有模型端点配置提交到仓库。

共享固定版本兼容修复专项：starter-packs-live-stack / explicit-starter-import / starter-pack-upgrade 共 30/30 通过；API typecheck 与 lint 通过。包括正逆序全包导入、旧版本保留、手动停用保留、用户/URL 内容拒绝覆盖、同版本分叉和失败请求重放。真实模型调用未执行，用户本地命令尚未回传结果。
