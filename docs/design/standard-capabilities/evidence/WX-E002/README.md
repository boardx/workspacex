# WX-E002：共享元数据与完整包传输契约

本提交提供标准编号/来源描述和可信 Skill 包结构；不重新实现权限系统，也不声称所有标准工具已接入。包契约由后续 WX-E004 数据读取与传输使用。

验证（worktree，2026-09-07）：

- `cd packages/contracts && pnpm exec vitest run tests/standard-capabilities.test.ts`：19 passed。
- `cd packages/contracts && pnpm exec tsc --noEmit`：退出 0。
- 独立 reviewer 复跑 19 项通过。原 review 的 3 项问题均已修复：大文件 Base64 正则栈溢出、分支名误作固定版本、生成 JSON 缺少漂移门控。

测试包含 8 MiB 文件边界、路径别名拒绝、唯一入口、非法授权字段、固定版本，以及生成文件逐字一致检查。SHA256 字段格式不等于实际字节完整性；读取端必须计算并比对。JSON Schema 不能表达所有跨字段不变量，Python 消费端另行检查并测试，不将生成结构误当完整授权校验。

生成：`cd packages/contracts && pnpm exec tsx scripts/generate-standard-capabilities-schema.ts`；追加 `--check` 只检查。常规 contracts 测试已纳入生成结果一致性门控。
