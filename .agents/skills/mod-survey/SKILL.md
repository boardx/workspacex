---
name: mod-survey
description: 问卷创建、模板、题目编辑、发布、填写和结果分析；修改问卷能力时使用。
---

# 问卷模块

负责问卷从创建和模板选择，到题目、发布、填写、回收和结果分析的独立迭代边界。

## 代码地图

- 前端：`apps/web/app/studio/survey`、`apps/web/app/studio/survey/[surveyId]`、`apps/web/app/studio/survey/templates`
- API：先用 `rg -n "survey|questionnaire" apps/api/src packages/contracts/src` 定位现有 application/domain/controller。
- 契约与数据库迁移必须作为同一变更检查，避免前端 mock 成为第二事实源。

## 迭代约束

- 新建问卷应提供稳定默认名称；标签是可选元数据，不得阻塞创建。
- 草稿、已发布和已关闭状态要区分；发布后题目版本不可被静默覆盖。
- 结果分析只读取当前问卷版本的有效回答，并保留匿名/权限边界。
- 模板复用要复制内容而不是共享可变题目对象。

修改前先读问卷路由、契约、持久化实现和现有端到端测试。

## 模块 SOP

先读本文件与 feature 验证契约，在独立 worktree 中修改；题目、发布或结果变更跑问卷 UI/API 及版本回归测试。

## 踩坑与经验（append-only）

- 2026-09-26：遗留结构化问卷在读取时只引导一次 Markdown source；已经发布的快照不回填 sourceSnapshot。证据：`apps/api/tests/survey/survey-source-lifecycle.test.ts` 的 legacy-publication 回归。

## 知识回流规则

谁修改本模块，谁在 PR 中追加可验证经验；不删除旧条目，推翻时注明替代来源。
