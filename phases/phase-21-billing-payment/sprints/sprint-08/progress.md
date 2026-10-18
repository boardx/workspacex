# 进度日志 — Sprint 21/08

## 当前已验证状态
- F08 / issue #5818，分支 worker/coord-voice-21-f08；未 passing、未提交 PR。
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
