# Team / Enterprise 契约消费增量（设计材料，待正式签核）

Issue6099 / Draft6101。沿用已采用UI，记录核心schema与原型消费的真实浏览器证据；没有后端、真实支付或持久化，模拟结果刷新消失。原已采用pricing-v1截图不覆盖。本目录不代替完整第③件或人工签核。

使用标准with-test-isolation wrapper运行 `pnpm --filter web exec playwright test -c playwright.prototype-audit.config.ts pricing-preview.browser.ts`，CI=1且PRICING_PREVIEW_EVIDENCE_DIR指向独立目录。既有prototype-audit无条件profile覆盖5用例，断言零billing/platform组织后端请求及七态可达。各轮完整命令输出分别在design-deltas/team-enterprise-v1/evidence的初始日志、quote-contract、entitlement-contract和catalog-contract目录，不把重复5用例相加为独立覆盖。最新目录/渠道版含美国Team增员，5通过、清理0秒。

- [首批：4位成员与5个已购席位](team-capacity.png)
- [首批：手动额度校验失败](grant-invalid.png)
- [首批：有效的额度与原因输入](grant-valid.png)
- [首批：Enterprise模拟授予结果](grant-result.png)
- [报价消费：增员金额与共同到期日](team-quote-add-seats.png)
- [权益消费：已用／已购、月度余额及永久余额](team-entitlement.png)
- [目录／渠道消费：美国Team增员](team-us-add-seats.png)

新增报价、权益和美国增员图均已目视复核，布局沿用原采用版本。输入取packages/contracts/src/billing-team.ts，原因和额度精度复用共享契约。真实平台权限、事务幂等、支付、全部成员入口容量与小数累计PG前置仍待正式签核后实现。

- [已付订阅历史消费：年付仅一条真实形状记录](team-annual-history.png)

历史增量对应evidence/history-contract的定向Team100、原型22、browser5和types/lint9。历史schema/mock验证不代表真实付款或cursor范围验证；年付截图已目视复核。

- [增员模拟确认消费实际形状的收据](team-seat-receipt.png)
- [人类确认：升级保留原已付发放计划](enterprise-prepaid-retained.png)

用户已确认升级后的已付计划处理，规范见同束domain及human-decisions；旧待答标记已解除。最新browser5实际覆盖保留计划文案且零计费HTTP，自动清理0秒；升级图已目视复核。业务确认不等于整束签核或真实九月worker已实现。

独立一致性复核补齐的界面（真实browser7，零计费/平台HTTP，自动清理1秒；五图已目视核对）：

- [七人团队首次购买：7席、130,000月credit及含额外席位总价](team-initial-seven.png)
- [Enterprise账户：无旧计划，人工管理](enterprise-account-manual.png)
- [Enterprise账户：保留原已付Team发放计划](enterprise-account-prepaid.png)
- [升级处理中：保留Team并查询原操作](enterprise-upgrade-processing.png)
- [升级需核对：保留原套餐，联系平台及原编号](enterprise-upgrade-needs-review.png)

入口仍为/preview/pricing；团队账户示例下拉切换四种事实，管理员区可选三种升级结果。金额与状态来自严格模拟quote/权益/操作，不代表真实财务或权限路径实现。材料在design-deltas/team-enterprise-v1，仍待当前精确SHA独立复核及整束签核。
