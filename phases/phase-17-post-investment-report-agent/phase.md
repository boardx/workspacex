# Phase 17 — post-investment-report-agent

- **slug**: post-investment-report-agent
- **状态**: not_started
- **创建于**: 2026-09-15

## 目标
交付一个可公开访问的独立 Agent —— **投后管理报告 AI 生成单元**（落地页 `http://www.boardx.com.cn/agent/team4`），
帮基金投后管理人员把「读完一包投后材料 → 做财务趋势与同业对比 → 交叉验证找隐性风险 → 产出可追问的投后研判报告」
从若干人天压缩到一次会话内完成，且每条结论可回跳到原文位置或外部来源链接。

## 范围与边界
- 本阶段交付：`/agent/team4` 公开 Agent 落地页与会话、投后材料包上传与解析、财务指标抽取与趋势分析、
  外部公开信息与可比公司检索、跨文档交叉验证与风险分级、两处人工确认关口、定向深挖、
  最终投后管理报告产出物与出处链。
- 明确不做：不改 deep-agent 内核与 MCP 授权分层；不新建第二套聊天 UI（复用 mod-chat）；
  不做基金投决/退出流程的审批与签批系统；不接入付费企业征信数据源（本阶段只用已接线的检索与浏览器工具）；
  **不下"该不该退出"的投资结论**（见 `requirements/00-overview.md` 硬边界）。

## 与 Phase 16 的关系
Phase 16（`/agent/team1`，上会材料智能审阅）解决**投前**"材料够不够上会"；本阶段解决**投后**
"已投项目现在怎么样、风险窗口在哪、退出条件是否具备"。两者共用同一套装配底座
（公开 Agent 路由、材料包、带定位解析、HITL 关口、产出物与出处链）。
**凡 Phase 16 已建成的能力，本阶段一律复用，不建第二套**；差异只在标准清单与分析规则
（`03-analysis-standard-and-evidence.md`）与报告模板。

## 需求 → 功能清单 流水线
1. 原始需求见 `requirements/`（本阶段由人类直接交办 + 三份附件：MAAU 画布、HMW 问题定义卡、
   交互时序图，以及测试方案 docx《投后管理报告AI生成场景 V1.0》）。
2. 调 **requirement-author**：读 `requirements/` 全部 `*.md` → 生成 `feature_list.json`。
3. `requirements/` 是输入，不是权威；权威永远是 `feature_list.json`。

## 权威功能清单
本阶段唯一权威功能来源是同目录的 `feature_list.json`（当前尚未生成，不得声明任何 passing）。

## 退出条件
- `feature_list.json` 全部 feature `passing`，且 `runtime-readiness.json` 经独立门禁转 `ready`。
- `requirements/04-acceptance-tests.md` 的 A/B/C 三组测试在真实模型链路上达到该文件规定的通过标准。
- 阶段 `progress.md` 收尾，无未记录半成品。
