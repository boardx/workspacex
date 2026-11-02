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

新增报价、权益和美国增员图均已目视复核，布局沿用原采用版本。输入取packages/contracts/src/billing-team.ts，原因和额度精度复用共享契约。真实平台权限、事务幂等、支付、全部成员入口容量与小数累计PG前置仍待正式签核后实现。已付Team剩余窗口在Enterprise升级后的处置仍待用户答复，不默认停止、退款或折抵。
