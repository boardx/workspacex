# 完整 base 的 API 分片执行 — #5959

原因证据：run [40522651876](https://github.com/boardx/workspacex/actions/runs/40522651876)，job 122258757714 在80分钟终止。新保留日志有371个 API 文件、6795项测试通过，无失败断言；非 API 阶段先消耗约46分钟。不是由余额充值功能断言引发。

改动：原本地 `verify:ci-base` 保留完整测试。CI 将非 API Turbo 图与 API 默认套件分片、独占套件拆开。分片数仍唯一来自 `.harness/api-test-shards.json`。core 去重前要求编译、发现、所有默认分片和独占套件全部成功。默认/exclusive JSON 报告必须有实际通过测试，且文件身份精确匹配安装版 Vitest 发现；SHA、run、attempt、报告/日志摘要匹配后才能合并并生成完整 manifest。

验证：
- Red：新增验收测试首先因缺实现失败。
- 8个相关测试文件最终119项通过；扩展 artifact 身份/缺片/替换文件/跨片重复/全跳过反例后，新增套件19项通过。
- 扩展 CI 契约集：24文件230项通过；另一个原有 Playwright discovery 子进程在本机并发负载下达到40秒内部超时，单独复测随后通过（1项，16秒），未修改该原有测试。
- 安装版 Vitest 实际发现：1624默认文件，8片各203文件；独占1文件。
- Turbo 实际 dry-run：完整21个 test task，非 API20个，差集严格为 `@repo/api#test`，无额外遗漏/新增。
- 独立只读 review 发现并修正数据库名连字符、零执行验收、只比文件数三项问题；第二轮未发现阻断项。

真实 GitHub 完整 base 尚待执行；不能以本地契约测试或 PR 分支的跳过状态替代。

首次PR控制平面检查229文件2647项通过、仅workflow-actions-node24失败：下载artifact步骤用了v5而非仓库审计的固定提交。已改用权威审计要求的 `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`；相关3文件98项通过。首次完整运行40548327387已验证真实coverage与部分API分片，但其源码仍有该已知Action检查失败；需以修正后的新运行作为完整结果。
