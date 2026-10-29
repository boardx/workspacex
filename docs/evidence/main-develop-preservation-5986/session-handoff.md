# 整合交接 #5986

本轮授权：先将main修复同步develop，保留优化，再晋级main；不执行CN生产发布。冻结两边SHA见baselines.json。合并为双父merge commit，不squash、不force push。唯一冲突选择依据、验证及边界见README.md。

180个单测通过，4个已有skip不算通过；fixture API用量组件浏览器通过；真实图片附件浏览器1 passed/1已有fixme。typecheck/lint和内容/祖先审计通过。工作树仍沿用本会话目录，没有新worktree。图片E2E的隔离栈已由包装器释放。

接下来：独立审阅并确认PR exact head、第一阶段PR base=develop通过门控后用merge commit合入；fetch验证后创建develop→main晋级PR，再过门控并merge；最后对origin/main重跑verify-preservation.py。用户已明确授权此次分支整合，不需要再次询问是否推进。若共享分支有新变更，重新检查与验证，不强推覆盖。

CI与远端合并的最终事实记录在issue #5986/对应PR，不将本文件的准备状态冒充最终完成。生产CN部署另走发布流程，本次不执行。
