# 真实商品目录交接

唯一工作区 /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，当前分支 worker/cn-us-price-catalog，依赖父提交499c22a20（个人支付契约）。

测试命令：pnpm --filter @repo/api test:billing-provider；pnpm --filter @repo/api typecheck；pnpm --filter @repo/api lint。HTTP目录测试为 tests/billing/pricing-catalog.test.ts，通过vitest.billing-provider.config.ts纳入测试，真实loopback listener会自行关闭。

UI PR6087因队列把括号issue号当PR号，已只重写提交说明，文件tree不变。最新UI head a95414aaf52b95b606f5c71edbfb3bcf995ca10f，旧d4cf已过期，必须实时读取新head检查。已获用户明确任务级例外授权：本次定价PR在逐PR检查/独立审查通过后可正常集成develop，不admin bypass，不授生产权限。不可仅凭本文件宣称CI绿。

先集成UI，再将个人契约分支去掉旧UI祖先并对齐develop；契约集成后将本分支去掉499c22a20及之前依赖祖先，对齐develop。每个PR只对应自己的issue。后续提交引用issue用 Refs #N，不用括号号，避免merge queue误解析。

本会话自己的安全备份stash为ba557b9372293e2755363dba3bc29cb2596a9917（已完整apply，工作区恢复）；不要误用或删除其他会话stash。没有启动Docker。只保留供人工预览的本地Next端口3526；不操作部署会话独占资源。
