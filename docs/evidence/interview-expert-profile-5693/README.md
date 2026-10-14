# 专家完整画像 — #5693

原始内置资料仍只有 experts-persona.json 一份；persona-library 只补全性格类型声明。

新增字段：分类、所在地、年龄、职业、目标、兴趣、痛点、动机、影响因素、三个性格维度、服务价值、典型建议。七个原字段保留。契约通过现有 DigitalExpertCatalogRow pick/partial 派生，不接受 Agent ID/鉴权配置。旧记录可缺省 profile，详情显示未填写，不生成默认事实。

## 验证

- `pnpm --filter web exec vitest run tests/ui/interview-expert-library.test.tsx tests/lib/interview-virtual-expert.test.ts tests/ui/interview-markdown-editing.test.tsx tests/ui/interview-studio-home.test.tsx`：94 passed。新增详情/表单断言先跑红（3 failed / 5 passed），实现后转绿；完整资料及带代码标题的字段往返，canonical 仅一个专家锚点。
- `pnpm --filter @repo/contracts exec vitest run tests/interview-expert-library.test.ts`：13 passed。旧行/部分资料兼容；年龄、性格范围复用目录，拒绝未知身份字段、CommonMark 标题、未闭合代码、跨列表项形成的 setext 标题。
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/itv/interview-custom-expert-library.test.ts`：4 passed。实际 PostgreSQL JSONB 完整保存/重读/幂等，不同 actor/org 不披露，非成员拒绝。未增加迁移，实际写读证明现有 JSONB 可存可选 profile。
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import e2e/interview-expert-library-live.spec.ts`：1 passed。真实登录/HTTP/PG，无 route 拦截或模型调用；逐项核对内置源资料，新增全部字段、刷新、查看、选入 canonical、刷新重读；实际 API 创建旧七字段画像并验证缺省资料显示未填写。375/1280 检查 dialog scrollWidth <= clientWidth。
- web、api、contracts typecheck 与所改 Web 文件 Next lint 通过；init.sh 基础验证通过。

## 图片

- [内置详情375](builtin-full-375.png)、[内置详情1280](builtin-full-1280.png)：文字可读，无横向溢出，完整资料在弹窗内纵向滚动。
- [新增表单](custom-full-form.png)、[新增并刷新后的详情](custom-full-reloaded.png)：真实隔离环境的模拟资料，非生产写入。

测试隔离脚本已释放本次数据库与浏览器栈（browser 清理1秒，PG清理0秒）。不涉及部署，不声明线上已更新。协调 tick 因未配置 COORD_GATEWAY_URL 失败，未认证或续约。
