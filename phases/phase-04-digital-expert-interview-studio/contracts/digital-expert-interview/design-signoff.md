---
bundle: digital-expert-interview
phase: "04"
covers: [F01, F02, F03, F04, F05, F06, F07]
status: confirmed
confirmed_by: shenyangjun
confirmed_at: 2026-08-11T23:53:35+08:00
---

# 契约束 `digital-expert-interview` 设计签核

覆盖 F01–F07，依据 `requirements/01-digital-expert-interview-studio.md` 与 ADR-105。

## 束边界

本束负责数字专家访谈 Studio 的八态状态机、持久化用例、HTTP/Web 客户端、首页、快捷访谈、五步批量流程、详情、报告和真实 E2E。它扩展 Phase 01 `interview`，复用 Phase 00 Agent/Context/Artifact/Identity 契约，不复制范围、鉴权、错误信封、真人授权、录制或撤回链。

## ① UI

材料：`ui.md` 与 `../../ui-preview/digital-expert-interview/` 的 10 张截图。

- [ ] 首屏只有历史访谈与专家列表两个主标签。
- [ ] 专家快捷访谈、新建、详情、报告均为完整页面。
- [ ] 新建第一步包含名称、标签、主题；确认主题后才生成专家。
- [ ] 专家审核、针对性问题、并行访谈、可追溯报告五步符合预期。
- [ ] 详情状态清晰，返回历史有效，右上角操作按钮完整不裁字。
- [ ] 不出现真人、用户画像或语音/视频数字人入口。

## ② 用例

材料：`domain.md`、`usecases.md`、`coverage.md`。

- [ ] 八态闭集与五步迁移正确，所有跳步由服务端阻断。
- [ ] 最后一位专家不可删除；问题只能属于已选专家。
- [ ] 单专家失败与报告失败均保留已有成功结果和素材。
- [ ] 快捷访谈自动进入历史，可带来源转为批量。
- [ ] 报告发现必须引用专家、问题、回答并恒标探索性。

## ③ API 契约

唯一落点：`packages/contracts/src/interview.ts`（在现有文件中扩展）。

- [ ] 不新增第二个 interview 契约文件或手写 Web/mock 类型。
- [ ] 复用 `NO_INTERVIEW_ACCESS`、`CONCURRENT_MODIFICATION`、`DEPENDENCY_UNAVAILABLE`、`PERMISSION_REVOKED_MIDWAY` 的既有语义。
- [ ] 新增数字访谈专用 schema、操作和错误码时不改变真人访谈既有行为。
- [ ] 请求和响应均由契约校验，401/403/依赖失败不得被客户端转为空集合。

## 跨束约束

- Phase 01 `interview`：同一契约文件与身份/范围单源；用户已把本阶段串行所有权授予 `coord-user-research`。
- Agent/Context/Artifact：访谈只保存专家与材料版本快照和来源指针，不创建组织级数字专家身份。
- Context API：专家材料不得从数据库、向量库或对象存储直读；权限撤回后不得继续复制来源内容。
- 探索性边界：本阶段没有强洞察、决策依据或组织晋升写入口；未来接入须另走 Phase 03 治理签核。

## 人类确认动作

逐项评审后，由人类把 frontmatter 的 `status` 改为 `confirmed`，并填写 `confirmed_by`、`confirmed_at`。Agent 不得代签。之后还需本阶段 `design-coherence.md` 覆盖本束并确认，F01–F07 才可进入 sprint。
