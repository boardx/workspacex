# 问卷需求

## R1 模块独立
问卷是独立 phase。后续问卷新增能力、契约修订、UI 调整都在本阶段维护。

## R2 参考来源
问卷直接参考 boardx-dev-template 的问卷系统；在当前仓库中，以已落地的 `/studio/survey` 资源库、`packages/contracts/src/survey.ts`、`phases/phase-02-visible-outcomes/design-deltas/survey-resource-library/contract.md` 和 `survey-continuous-document/contract.md` 作为可追溯细化依据。

## R3 资源库
访问 `/studio/survey` 时停留在问卷与模板资源库；左侧只有问卷列表和模板列表两个一级入口；问卷卡进入 `/studio/survey/:surveyId?step=design`，模板卡进入 `/studio/survey/templates/:templateId`。

## R4 创建与模板
用户可新建空白问卷、从模板新建问卷、新建模板、编辑模板；名称与标签是创建入口的必填可见信息；模板保留分类、题目数、报告章节数和使用次数。

## R5 五步工作台
问卷工作台包含 design、template、publish、responses、report 五步；题目连续渲染，报告章节连续渲染；章节 output 支持 text/chart/image，chart 时必须选择 chartType。

## R6 发布回收
发布前服务端执行质量门禁；发布后生成链接并进入回收状态；回收进度、未交催填、截止、匿名/实名约束和 responses.csv + schema.json 物化可验证。

## R7 分析报告与投票
分析报告按章节输出，保留样本量、题目来源和图表类型；现场快速投票作为问卷的轻量派发形态，支持倒计时、匿名口径、回流报告和证据角标。

## R8 异常流程
非法 step 回落到 design；匿名问卷禁止个人反查；模板和问卷返回路径保持 URL 一致；loading、empty、error 都有稳定可见状态。
