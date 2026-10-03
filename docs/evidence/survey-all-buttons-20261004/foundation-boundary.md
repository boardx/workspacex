# 基础验证边界

`pnpm run verify:quick` 第二轮退出1，72/75任务成功；唯一剩余失败为 `packages/local-runtime/test/parity.test.ts:33`，三项 API 环境变量未分类：DESIGN_HTML_PAGES、KG_EVAL_FIXTURE、KG_EVAL_RECALL_MODE。定点 parity 重跑同样退出1。未跳过、弱化断言或把此项混进问卷PR。主session已授权独立基础issue/PR最小修复，尚未完成。

此前两个本地环境问题已定点修复并验证：ignored Finder .DS_Store阻止starter-pack目录扫描（移到private临时备份）；canvas冻结安装忽略脚本后缺native binary（官方依赖重建，native context真，fabric22测试/contract6测试过）。这些定点通过不代表全基础通过。原始命令日志留private，不提交含环境配置的原始输出。
