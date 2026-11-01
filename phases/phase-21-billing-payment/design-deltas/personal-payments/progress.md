# 个人支付进展（当前事实）

Issue6093，worker/cn-us-personal-payments。前置新用户PR6102已在2026-11-01T23:34:47Z真实正常merge develop c04c332a1563f8168964e9497a59dcb51ad4017c，6092由PR关闭，合入前72checks无异常。P5从原父b4dd剥离22提交，source fb5f2270237b0b5ddf696abb2f621358e0081d69已获独立只读全scope ACCEPT，未发现新具体源码缺陷。当前只补最终文档/证据，待最终精确SHA复核、正常push及单PR/CI，不假passing。

重基原251个P5路径与远端检查点80e287ca9716c1e07859b62d6034e22d4457a230逐字相同。唯一冲突为恢复迁移清单；机械验证actual base完整前缀加四项P5 SQL恰等于旧80文件后解决，未知/缺失/重复拒绝保留。range-diff仅该commit因前置三项已进base而上下文不同，其余21项全=。没有夹入P3/P4实现或Team草案。actual-base-*保存原始核对输出。

已实现：服务端目录与部署市场、持久化意图及幂等、微信一次购买/手动续费、Stripe自动续费及权威重读结算、按原购买锚点调用逐月授予、账户/历史/门户取消及自动恢复。正常/billing接线沿用已采用UI；个人显示真实钱包、付款期限与月度额度，未知事实不伪造为0。旧销售入口在新代际下拒绝，不保留旧权益。默认UIflag关闭、epoch未激活；本项未执行生产清理、扣款或部署。

personal-order-outcomes-v1已获用户明确采用并授权回填，签核confirmed，不再索要个人恢复授权。待支付要求真实绑定；已付/关闭/人工核对允许缺绑定，原key仍恢复原ref，浏览器先GET owned订单再展示结果/付款，不因空地址显示成功。独立审查指出的缺绑定、QR重试P2与Stripe fragment P1已闭环；合法Checkout fragment原样保留，https/精确host/port/credentials约束保留，微信及门户仍拒fragment。后续错误分类显式typeof不输出内部码；删除重复个人browser子集config，canonical完整4spec仍覆盖且实跑。

定向证据：order-outcomes下contracts1254/provider166/React107/金融PGHTTP39/旧PG42/local parity12/完整browser17；review-fixes下URL-state-checkout29、错误分支checkout22、HMAC真实HTTP目标1（33过滤）、typeslint9及完整browser17。两次browser17各有真实命令输出，不把它们相加为34项独立覆盖。当前source字节等价，复用证据，不为重写SHA重复宣称重跑。商户为独立签名loopback，未在线实付；计费HTTP未拦截，仅身份壳与托管支付页受控。注册邮件worker关闭，只验证outbox。

Node22.23.2旧stack66全面检查：所有静态门禁、harness249文件2816过/4skip、全types/lint、contracts1254/local-runtime250等包、Web966文件8438过/5skip通过。API完成82文件后主动SIGINT结束本地单worker串行，init exit1，**不是完整full PASS**；剩余完整API必须由本PR标准独立DB分片和queue继续验证，不缩CI范围、不提前合。raw gzip/summary/cleanup在review-fixes/node22-full-partial-*。前3次真实full红（固定假key扫描/错误分类静态误报/Node22.14原生ESM加载）保留；前两项已修不改门禁，加载文件在22.23.2整16项绿，不混称首次全绿。

主动中止后wrapper未完成自动清理，已手动仅down-v本次wsx-6468、核对owner43114及其后代退出和ports可绑定后释放该owner1 stack lease/13 port markers；其他owner未碰，不称自动cleanup成功。当前无本任务Next/Chromium/compiler/compose。实际新base快速init及迁移scope2现已通过；不把快速init拼为full完成。正常hook/新PR CI仍待执行。

本次定价逐PR正常develop集成授权持续，禁止admin bypass。Team独立Draft6101 pending，可执行schema第③件未完成；已问已付年费剩余窗口在Enterprise升级时如何处理，尚待用户答，不能把超时当同意。个人签核不覆盖Team。旧计费全量reset及epoch切换仍独立后续，未生产执行。历史迭代/失败详情见对应evidence、recovery-notes/ui-runtime及Git历史，不把旧当前时态当现场。
