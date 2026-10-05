# 平台模型测试台 UI 验证

真实组件 `platform-model-testbench.tsx` 通过已校验的 `live-platform-model-test.ts` 对接候选/启动/查询/取消契约。组织由现有真实目录服务选择，服务器决定实际计费操作人；页面不提交任意用户 ID。

## 本轮命令与结果

- `pnpm --filter web exec vitest run tests/ui/platform-model-testbench.test.tsx tests/lib/live-platform-model-test.test.ts tests/lib/model-test-money.test.ts`：退出 0，49 项通过（23 UI + 6 严格 API 契约 + 20 精确金额转换）。见 `ui-tests.txt`。
- `pnpm --filter web exec eslint components/admin/platform-model-testbench.tsx lib/live-platform-model-test.ts lib/model-test-money.ts tests/ui/platform-model-testbench.test.tsx tests/lib/live-platform-model-test.test.ts tests/lib/model-test-money.test.ts app/platform-admin/model-tests/page.tsx`：退出 0，无错误、无警告。见 `ui-lint.txt`（记录干净退出结果）。
- `node scripts/model-testbench/verify-ui.cjs /tmp/wsx-model-testbench-ui-final`：退出 0；375/768/1280 均无准备状态与旧测试历史横向溢出，WCAG 2 A/AA axe 无违规，pageErrors 空。见 `ui-browser-results.json`。
- `bash apps/web/scripts/lint-design.sh`：退出 0，设计规则全通过。见 `ui-design-lint.txt`。
- Web 全包 typecheck 首轮定位并修复 AppShell previewRole 与测试 strict mock-call 类型错误；最终整体 typecheck/CI 由集成协调者统一执行，不据早期输出宣称通过。

## 交互与失败边界

候选明确区分可调用与不可用及原因。文字、图片、TTS、ASR、embedding、rerank 的输入结构不同，未知路由/币种/计费单位或安全边界禁用。费用/timeout/输出或数量上限必须填写并重新确认；不从公共模型目录猜价格、账号可用性或适配。

费用输入显示真实候选币种金额，最多六位小数；使用十进制字符串和 BigInt 精确换算微整数，拒绝科学计数法、超精度、零上限与 int8 溢出，不使用浮点舍入、不填写默认金额。已知结果费用按实际记录币种的小数金额显示；币种未知时禁用测试，不用候选币种猜结果币种。

总 Token、输入 Token、输出 Token 独立展示；null/缺可选字段显示未知，显式报告 0 才显示 0。原生 ASR total 不提供时仍保留真实输出 Token 部分计量，不相加猜总数，不当零消费。当前普通组织 ASR 上界未确认时以明确中文原因禁用。

测试 UUID 在启动前同步锁定，重复点击不产生第二次 POST。启动响应不确定、取消失败、GET 身份错配均保留原测试；查询轮询只有 GET。成功状态与结算状态独立显示，未知/held 不宣称免费或释放预留。用户明确确认旧预留仍保留后可以准备新测试，原记录仍可查询；新测试输入与费用边界清空，必须再次显式启动，不自动重发。

刷新后恢复通过显式表单：选择原组织、填写已保存测试 UUID，仅发 GET。非法 UUID 在本地拒绝，查询失败/不存在保留 UUID，响应组织或记录身份不匹配不覆盖现有状态。没有自动恢复 POST，也没有 sessionStorage 跨账号恢复。旧模型记录不以当前候选名称猜绑定。

页面卸载终止活动浏览器请求，供应商调用可能继续执行；页面明确说明离开页面不是服务端取消。未知费用保持预留，后台预算检查仍是防止超卖的权威。

## 截图证据边界

所有 `ui-*.png` 为真实测试台组件在静态 file fixture 中运行；组织目录与模型测试 HTTP 服务采用**明确替代响应**，AdminScreen 外壳缩为标题与说明以隔离会话。截图顶部保留边界提示。这些截图证明组件交互、响应式与可访问性，不代表正常平台登录、真实组织权限、供应商参数/费用或部署端到端验收。没有启动 App/API/数据库服务，没有供应商调用、没有生产写入。
