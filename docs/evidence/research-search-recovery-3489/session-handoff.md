# #3489交接

分支codex/research-search-recovery，基线bcb045418，用户直接交办检索恢复与继续流程。功能与证据边界见progress.md。

独立预审发现并修复：provider同码异常跨重试分类；遗留running历史终结；普通complete不能通过清理遗留状态绕过报告门禁；批准对话start/retry提案使用同一恢复入口。

当前角色coord-deep-research，无合并权，仅前台心跳。最终PG回归、exact SHA review及PR/CI结果在对应GitHub issue/PR记录；线上原会话仍需部署后的真实外部调用复测，受控测试不代表该会话已经恢复。
