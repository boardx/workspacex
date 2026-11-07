# 新用户赠送进展

Issue6092，worker/cn-us-welcome-credits。实际前置年付PR6100已正常merge develop98de549bbe77c459362ed42fc9455c5589dd1f1e；从旧父b766剥离远端63bd后，源码为2706a5be56406c6eb864721d00f1a136f31b9289。三个重放提交range-diff全=，P4原45路径逐字tree equality退出0，无P5夹入。独立reviewer对2706源码静态ACCEPT；当前只追加最终文档/证据，待最终SHA复核及正常PR/CI集成，不假passing。

实现credentials AFTER INSERT事务触发器，SECURITY INVOKER，所有真实新建账号入口一次赠送1,000 credit、实际到账起30天到期；存量不补、登录/切组织/二次入组不触发。注册同事务回滚，代际默认未激活、app只读，不变更邮件/邀请/项目角色。欢迎来源与付费月度批次分离，共用钱包、先到期扣减、债务与到期回收；内部读取真实授予与到期，符合资格却缺记录不补发/不当0。SQL由契约生成，恢复清单精确追加welcome项，未知/缺失/重复拒绝保留。

实际develop基线刷新验证（Node22.23.2）：普通init快速路径通过；provider61/61、隔离PG及真实注册HTTP六文件58/58、迁移清单2/2。PG peak7、cleanup1s、总41s。邮件worker关闭，只验证durable outbox，未发真人邮件。证据actual-base-*。P5此前full检查的Node22.14 ESM环境失败已在22.23.2目标复现修复；本P4不把快速init或目标验证冒充完整full init。

既有完整证据保留：contracts1248、历史UI5、旧auth未激活回归56、生成DDL一致性与类型lint；不称这些在本次重基重新执行。早期prepush24/25 Web tsc退出137，宿主swap约13GB、根因未定；随后同类型串行7/7、正常prepush25/25，未跳hook，旧红绿证据保留。当前源码与此前45路径完全相同。

正式个人权益HTTP/正常支付UI由P5接线，本项不伪造Stripe状态。epoch/生产清理/部署均未操作；逐PR正常develop集成授权持续，不用admin bypass。后续P5仍从原父b4dd剥离，必须等本项真实merge。
