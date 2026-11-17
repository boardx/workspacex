# AIDT Skill 入口登记修复回执

工作树 `/workspace/aidt-pr-20261117`，基线 HEAD `1a2ec212d38635a60b1337cc4a949ec564c0d7a8`。本 worker 仅修改 `packages/contracts/src/skill-entry-points.ts` 及其 `tests/skill-entry-points.test.ts`，共 23 行新增，未 commit、发模型或部署。

根因是 AIDT 六个阶段 Skill 与 `dt-summarize-project` 七个 stableName 未在入口权威表登记。原扫描会遍历历史/候选 SKILL.md，重复列出相同未登记 slug；这是缺归属，不是应放宽扫描的理由。保留所有候选/历史目录及原测试扫描规则。

依据既有语义，`HIDDEN_PLATFORM_SKILLS` 仅影响默认 Skill 库展示，不修改解析、安装、挂载权限或旧线程 pin。本次在该表对七个 slug 各登记一次，复用现有 `auto-triggered` reason，说明供 `ENABLE_AIDT_MODULE` 显式启用的 AIDT 模块宿主按阶段/报告任务挂载。没有新增 reason 枚举或改变 API 形状，普通三个入口的数组完全未改。

这不是新的 course-only 授权机制：已安装版本、旧线程及管理区“显示底层能力”的既有行为保留，关闭开关不会删除既有数据或撤销权限。自动挂载发生在既有教学宿主 `apps/web/features/aidt/lib/live-aidt-step-chat.ts`，本次没有改挂载实现。新增测试明确约束七个 Skill 均为 hidden、各登记一次、不能出现在普通三个入口，且说明模块启用/宿主范围。

## 实际红绿与门控

所有以下命令使用 `PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH`，通过已有 node/pnpm 与已有 workspace 依赖运行，没有安装。此 worker 的 `PNPM_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`npm_config_cache` 原来为空，未伪造为主任务的临时值；已向 root 如实说明。测试期间未修改运行环境配置。

| 验证 | 结果 | 原始日志 |
| --- | --- | --- |
| 修改前，contracts cwd：`pnpm exec vitest run tests/skill-entry-points.test.ts` | exit 1；原两红确实重现，2 failed / 4 passed，325ms | `/tmp/aidt-pr-skill-entrypoints-red.log` |
| 修改后，同命令 | exit 0；7 passed，318ms | `/tmp/aidt-pr-skill-entrypoints-green.log` |
| web cwd：`pnpm exec vitest run tests/ui/skill-entry-points.test.tsx` | exit 0；2 passed，8.29s；一个 Vite CJS 弃用提示 | `/tmp/aidt-pr-skill-entrypoints-web.log` |
| root：`pnpm run lint:shipped-pack-version` | exit 0；10 个标准包发货/构建版本一致 | `/tmp/aidt-pr-skills-shipped.log` |
| root：`pnpm run lint:skill-metadata-source` | exit 0；10 构建脚本、19 SKILL.md 单源门控通过 | `/tmp/aidt-pr-skills-metadata.log` |
| root：`pnpm run lint:skills-doctor` | exit 0；36 skill 的 230 个仓库路径存在；不证明引用语义 | `/tmp/aidt-pr-skills-doctor.log` |
| root：`pnpm exec vitest run --config apps/api/vitest.aidt-isolation.config.ts` | exit 0；7 files / 52 passed，4.57s，含不可变旧包、候选包/opt-in 及导入隔离 | `/tmp/aidt-pr-skills-isolation.log` |
| 两个修改文件 `git diff --check` | exit 0 | 当次 tool 原始输出 |

`git diff --name-only -- skills` 输出为空；没有修改已发包字节、旧 Skill 或任何源码包资产。上述发货 lint 仅证明其自身覆盖的十个标准包；AIDT 历史包与候选内容边界另由 52 项 isolation suite 覆盖，不互相冒充。

## 源码与日志指纹

- `packages/contracts/src/skill-entry-points.ts` SHA256：`d64c6d94140a7b23ab22c675f56bfe54aca865e72b373f1576b7aa425dbb467f`
- `packages/contracts/tests/skill-entry-points.test.ts` SHA256：`31b1d9ef4315ffd43c9b1d4b43a4d779e2d3be2b9009f2fd25787346ca42122d`
- red log：`2ea28f0d46671d1138eb4e685f124c5104be59238cb2a6b20e59824542402267`
- green log：`942663fd00b280fbd1c317f6ac61ed088fac2b3bafc25c89b0c9f99c793fe3fc`
- web log：`c48834e91fa7a32e213fd6ec660e448467817b35da2c09c6b0f85eafe3c46800`
- shipped log：`72dd2e2633b09443f441ce3aae6914fc86c3ebafbebd02e34ca5004bc43e4cf6`
- metadata log：`401e018019134367ca9a4626861393d33ed3667f1dde14eef7f13b676e82af86`
- doctor log：`980c8fa118ce32444e92058a6757174142dca14f639964dd2a8ae3dabbbf4e70`
- isolation log：`8a9be0c24a2295b033dddf0a707e4a0da8902348ee5248e8e8956075d9d6a308`

已在写入稳定后通知 `/root/pr_backend_review`，由其统一执行完整 contracts suite / typecheck / contract-source gate；本 worker 不重复该完整套件，也不把本回执的入口及隔离通过扩大为完整 contracts、PR CI、devapp 或课堂验收完成。

随后收到统一 owner 的实际回执：使用本次稳定后的源码，完整 contracts **147 文件 / 1504 项全部通过**，非增量 tsc exit 0、contract-source gate exit 0、diff check exit 0。权威原始回执在 `/tmp/aidt-pr-backend-final.md`；由该 owner 执行，本 worker 未重复运行。PR CI、devapp 和课堂验收仍不由这组结果证明。
