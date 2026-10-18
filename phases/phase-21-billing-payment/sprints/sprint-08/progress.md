# 进度日志 — Sprint 21/08

## 当前已验证状态
- F08 / issue #5818，分支 worker/coord-voice-21-f08；未 passing；实现候选 daaac6855e66b5f027a30517d6b08fce8a048ed5 已推送，PR 待创建。
- 2026-10-18 人类明确采纳 ADR-123；状态枚举与共享资格、用例已补齐。原签核记录未改写。
- 订阅读取/升级/管理 API、只读订阅快照、哈希购买意图、固定版本 Portal 已实现。
- 真实 HTTP/PG 专项29通过；contracts10通过；既有计费 UI 回归47通过；API lint/typecheck、web/contracts typecheck、init 快速路径退出0。日志在 evidence/。
- 独立审查两项 BLOCK（数据库失败500、安全诊断缺失）已修。共享角色故障注入已替换成本fixture事务PG故障，lint:test-shared-grant通过，无新豁免。
- 完整 verify:release 未通过：2517通过/2失败。HEAD 为现有主线3eb7d004c时，迁移门检查其前一提交发现旧 F06 见证无法验证（详见 baseline-transition）；CN治理夹具在全套运行期间失效，同一测试单独重跑通过。未因此声称完整门控绿。

## 在线边界
- devapp 已部署3eb7d004c，但实时 config 返回 enabledProviders=[]；未写线上配置。
- 参考后端 merchant 材料格式有效，但缺微信平台验签公钥/证书，旧 notify URL 不适用于 devapp。
- 人类提供的 /Users/shenyangjun/boardx/workspacex/.env.local 只含CN、模型和GitHub配置，无支付或devapp登录设置。未输出/提交其中值。
- F09 webhook、订阅UI、历史Stripe身份可信映射、真实商户验收和 token消费仍未完成。Portal回跳依赖商户默认 return URL。静态Payment Link不保证跨窗口Checkout创建幂等。

## 下一步
- 提交可审查的F08源码，复验真正候选SHA的完整门控，PR并跟到绿；不把测试当线上通过。
- 找到devapp安全配置入口后配置独立回调；Stripe webhook和UI仍按独立feature交付。

## 候选验证通过
- `pnpm harness verify --phase 21 --feature F08` 在 daaac6855 上退出0；包括 high_risk `pnpm -w run verify:release`。API 15305+独占4通过，Web8178通过，其他包和控制平面门控均由完整命令通过证明；保留真实skip/todo计数见candidate-results.txt。
- 原主线HEAD的历史迁移门问题在本候选19项通过；没有修改旧F06状态或篡改历史见证。独立 exact-SHA SOURCE ACCEPT。
- 微信真实只读GET certificates返回406，未取得可验平台材料；仅证明仍缺可信验签材料，不据此断言公钥模式。未创建订单/支付。
- PR后继续跟踪CI；本次文档/证据后续提交没有生产源码差异，不能把源SHA与证据SHA混为一谈。

## PR #5822 CI 修复
- PR: https://github.com/boardx/workspacex/pull/5822 。71b0952候选本地完整门控通过；CI simulation(all)在真实恢复catalog拒绝新迁移。artifact证明为UNREVIEWED_MIGRATION_SUFFIX，不是支付业务测试失败，也不是可忽略红灯。
- 显式把已审subscription迁移追加到recovery reviewedSuffix；历史prefix/完整suffix/排序/未来未知拒绝均保留。catalog先RED后2case通过，Python fixture wrapper9项通过。Linux完整迁移恢复仍以新CI为准。
