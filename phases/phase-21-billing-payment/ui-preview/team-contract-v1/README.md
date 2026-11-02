# Team / Enterprise 契约消费增量（设计材料，待正式签核）

Issue6099 / Draft6101。沿用已采用UI，新增核心schema与原型消费的真实浏览器证据；没有后端、真实支付或持久化，模拟结果刷新消失。原已采用pricing-v1截图不覆盖。本目录不能代替完整第③件或人工签核。

命令：标准with-test-isolation wrapper下 `pnpm --filter web exec playwright test -c playwright.prototype-audit.config.ts pricing-preview.browser.ts`，CI=1且PRICING_PREVIEW_EVIDENCE_DIR指向独立取证目录。现有prototype-audit无条件profile已收进该5用例；会断言没有billing/platform组织后端请求，页面所有7态可达。5通过，wrapper清理0s。此处仅选4张增量图，完整浏览器日志在design-deltas/team-enterprise-v1/evidence/prototype-browser-5.txt。

- [Team 4位成员／5已购席位与月额度](team-capacity.png)
- [手动额度校验失败](grant-invalid.png)
- [有效的额度与原因输入](grant-valid.png)
- [Enterprise模拟授予结果](grant-result.png)

输入严格约束取packages/contracts/src/billing-team.ts，原因复用既有platform Plan输入约束，整数上限不在UI另持一份。真实平台权限、事务幂等及付款仍待正式签核后的runtime实现。已付Team剩余窗口在Enterprise升级后的处置正在等用户答，不默认停止。
