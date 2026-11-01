# 个人支付在建交接

唯一worktree `/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui`，当前worker/cn-us-personal-payments；不用第二个worktree、不切共享checkout。远端source c2d3873c267e6f82f2686bfd15f4c3e968a9dc2f已正常push（prepush25/25、21cache），本提交只补验证记录与当前集成事实。保留共享stash，不回放旧UI/recovery备份覆盖当前源码。

用户已采用personal-order-outcomes-v1并授权回填/继续，签核已记录；本次正常集成develop授权持续，不重问、不admin bypass。Stripe fragment P1于f2884c794修复并独立代码闭环；c2错误分类与移除重复子集config增量独立ACCEPT。原缺绑定及QR重试P2已闭环。最终新base全feature审查和PR CI仍未完成，不假passing。

证据：contracts1254/provider166/UI107/PGHTTP39/旧PG42/parity12及browser17在order-outcomes；后续fragment URL/state/React29、更新checkout22、canonical完整browser17、types/lint9、目标实际HMAC PG1（33过滤）在review-fixes。HMAC每次随机合法whsec格式，不改扫描门。浏览器独立签名loopback，未在线商户扣款。邮件worker关闭，不向真人发信。

基础状态：普通init快速路径通过。full第一次scan固定假key误报、第二次错误码分类静态误报及无入口重复config已修，各项红绿/独立审查已保存。第三次full全部静态门禁通过，harness28文件856测试通过后停在studio原生ESM加载测试：当前shell Node22.14解析嵌套TS失败，相关源与actual develop无差异。已安装Node22.23.2下同一目标1通过、15过滤；这是补丁版环境差异，不改业务/门禁。后续命令显式PATH使用/Users/shenyangjun/.nvm/versions/node/v22.23.2/bin。尚未声称完整full init通过，最终实际依赖基线上还须完整检查；不把目标修复绿拼作全仓通过。

实际集成：充值PR6098 merge d886e24310ae50e8f7c6a74bbceb87c052514025；年付PR6100已在2026-11-01T22:32:25Z正常merge develop98de549bbe77c459362ed42fc9455c5589dd1f1e，6091于22:32:27Z由PR关闭，fetch后ancestor退出0。合入前72check均success/skipped/neutral；合入后plan另算，不混为合前证据。

接着：
1. P4远端63bd75abd29109a6ca7750060dd9687c2fd864f4从**旧父b766a58ccbf9b14dcccaf6e1a47c086f3b5ea2db**剥离到actual develop，range-diff/精确源码复核，再单issue6092 PR，负责到绿正常合入。
2. P4实际merge后，P5从**原父b4ddf725f79b2607a186ff82782ed10b520272a8**剥离，不能用新P4头当旧父。reviewedSuffix现含继承P3/P4三项及P5四项；冲突时保留实际base列表再加P5四项，不恢复旧列表。
3. 最终基础/全feature精确SHA独立复核、单issue6093 PR及真实绿CI。默认UIflagoff、epoch未激活，禁止生产reset/支付/部署。全旧计费数据清理与外部旧款/在途usage屏障仍是独立后续工作，未执行。

Team/Enterprise是独立Draft PR6101，分支worker/cn-us-team-billing-design head096892902；原草案问题已复审闭环、pending。采用原型的添加额度按钮仅Enterprise可见、整数1..1,000,000且原因必填，旧“所有列表行”观察错误已纠正。api.md不代替packages/contracts第③件；须补可执行schema/原型消费反例/正式复核后再一次请求人工确认。个人签核不覆盖Team。

当前所有本会话测试栈已由wrapper释放，第三次full清理1s，无自有Next/Chromium/compiler/compose剩余；Node目标测试无资源栈。其他发布/邮件会话资源不动。

## 最新覆盖（以上旧待跑边界已被本节更新）

Node22.23.2 full在66旧stack上已过全部静态、harness249/2816（4skip）、types/lint、contracts1254/local-runtime250、Web966/8438（5skip）。API部分已过，主动SIGINT停止本地串行，exit1，不是完整full PASS；剩余完整API必须由最终PR标准CI独立DB分片及queue证明，不能提前合。raw gzip/summary/手动cleanup实录在review-fixes/node22-full-partial-*。无源代码改变、无全量API完成声明。原Node加载文件16全绿。

主动停止后wrapper未自动完成清理，已手动清理本次project、核对无owned后代并探测ports，再仅移除owner43114的stack lease/13 port标记，其他owner不动；Docker只剩他人扩展。不要再让同一全API串行重复占工时，标准CI分片完整范围不缩小。

P4 #6102已canonical READY后正常入队，candidate c04c332a1563f8168964e9497a59dcb51ad4017c，当前仍AWAITING_CHECKS；新现场要读GraphQL candidate而非只看旧SHA。actualmerge后P5仍从原b4dd剥离，精确lease以届时本P5远端为准。

Team待裁决P2：Enterprise升级时已付年费剩余窗口不能被“不自动新增额度”偷换为停止已付额度。已在6099公开并用request_user_input_async问“继续原计划至已付期结束（推荐）/停止原计划剩额手动处理”；问题尚未回答，不重复问/不把超时当采用。待答案统一schema/确认摘要/收据/worker/测试及一次正式签核，pending不变。
