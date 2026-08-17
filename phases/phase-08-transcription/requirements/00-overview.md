# 转录需求

## R1 模块独立
转录是独立 phase。后续实时转录、个人转录、项目转录和历史管理都在本阶段维护。

## R2 主流程
用户访问 `/rec` 创建或继续转录文档；系统申请麦克风权限、创建 ASR ticket、接收 interim/final 片段并写入 recording document；历史列表可按名称和标签过滤。

## R3 回流与导出
转录结束后，音频、`transcript.jsonl`、必要的 `notes.md` 物化为 file-first Artifact，并保留时间码、speaker/channel、derived_from 和 SHA-256。

## R4 异常流程
麦克风拒绝不应导致页面崩溃；ASR 断线可重连；final/interim 去重；删除和保留期必须写审计。
