# Phase 16 — ic-material-review-agent

- **slug**: ic-material-review-agent
- **状态**: not_started
- **创建于**: 2026-09-15

## 目标
交付一个可公开访问的独立 Agent —— **上会材料智能审阅助手**（落地页 `http://www.boardx.com.cn/agent/team1`），
帮投资分析人员在集团投决会前，把「读完一包材料 → 对照上会标准查缺 → 交叉验证找矛盾 → 产出可追问清单」
从若干人天压缩到一次会话内完成，且每条结论可回跳到原文位置。

## 范围与边界
- 本阶段交付：`/agent/team1` 公开 Agent 落地页与会话、材料包上传与解析、上会标准清单比对、
  跨文档交叉验证与异常标注、两处人工确认关口、定向深挖、最终报告产出物与出处链。
- 明确不做：不改 deep-agent 内核与 MCP 授权分层；不新建第二套聊天 UI（复用 mod-chat）；
  不做投决会流程审批与签批系统；不做企业征信/工商数据付费源接入（本阶段只用已接线的检索工具）。

## 需求 → 功能清单 流水线
1. 原始需求见 `requirements/`（本阶段由人类直接交办 + 三份附件：HMW 卡、交互时序图、测试方案 PDF）。
2. 调 **requirement-author**：读 `requirements/` 全部 `*.md` → 生成 `feature_list.json`。
3. `requirements/` 是输入，不是权威；权威永远是 `feature_list.json`。

## 权威功能清单
本阶段唯一权威功能来源是同目录的 `feature_list.json`（当前尚未生成，不得声明任何 passing）。

## 退出条件
- `feature_list.json` 全部 feature `passing`，且 `runtime-readiness.json` 经独立门禁转 `ready`。
- `requirements/04-acceptance-tests.md` 的 A/B/C 三组测试在真实模型链路上达到该文件规定的通过标准。
- 阶段 `progress.md` 收尾，无未记录半成品。
