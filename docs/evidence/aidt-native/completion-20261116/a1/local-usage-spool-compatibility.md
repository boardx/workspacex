# LocalRuntime 持久 usage spool 兼容修复

独立真实模型验收发现Python当前始终要求持久usage journal。根Agent授权对普通本机运行器补齐同一必需字段，范围不含云端模型、计费政策或权限变化。

`deepAgentEnv` 仅新增 `DEEP_AGENT_USAGE_SPOOL_DIR`，取当前用户dataDir内的绝对 `usage-spool` 路径。原有callback、内部key、本机Ollama、默认profile开关及零外部模型设置均不改。`up` 仅在确有可启动Python运行环境时、启动前调用私有目录准备器：新目录0700；现有目录必须仍属当前用户且不可被其他用户读取，拒绝symlink、文件、非私有目录及非本用户/可被其他用户修改的父目录，不chmod、不删除或重建既有journal。POSIX最终打开使用O_NOFOLLOW并核对设备/inode/ownership；Windows继续沿用本机用户目录ACL边界，没有声称通过Windows Python运行验证。

实际验证：

- `pnpm --filter @repo/local-runtime exec vitest run test/usage-spool.test.ts test/aidt-config.test.ts test/config.test.ts`：18/18通过，3文件，04:48:29执行，429ms。
- `pnpm --filter @repo/local-runtime exec tsc --noEmit`：退出0，成功无输出，Node堆上限1GB。
- 自身文件的 `git diff --check`：退出0。

7个新目录/配置测试覆盖创建与跨启动保留journal、symlink目标不变、不私有目录不改权限、已有文件不删除、拒绝relative path、父目录ownership检查，以及default/aidt两profile在宿主故意设置云模型/外来spool变量时仍指向loopback/Ollama和自己的目录。初测发现环境umask会把0755新建测试目录收紧为0700，测试改为仅对新建临时fixture的子进程设置umask后得到真实不私有反例；未改用户目录权限。TypeScript随后修正两处仅测试代码的optional-property narrowing，最终复测通过。

这些是文件系统安全与配置兼容的回归，不是本地Ollama真实对话、普通学生资金、教学质量或Mac/Windows实机验收。普通consultant自己的钱包实际仍为0，见 `normal-student-wallet-readiness.json`；独立云模型工程栈与普通 `aidt:local` 继续分开记录。
