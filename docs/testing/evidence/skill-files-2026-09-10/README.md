# Skill 文件与 Agent 绑定：精确候选证据

验证提交：`6a4248f5b1ade756c27c53f8cd78e3491fb6456f`。运行前、运行后 `git diff HEAD -- apps scripts` 均为空。

执行命令（仓库根目录）：

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- node scripts/studio-skill-files-e2e.mjs
```

结果：真实 Chromium 单 worker **1 passed，0 skipped**，测试 10.2 秒，标准隔离全过程 39 秒。真实 dev-mode 登录、GitHub 导入、API 和 PostgreSQL；同批修改根文件、新增 reference、删除非根文件，刷新验证新版本及旧快照；从编辑入口进入绑定，固定新版本、恢复空 pins 后再次刷新验证。

- [结构化 receipt](persistence-receipt.json)：实际 Skill / Agent 版本、增删路径、旧快照保留证据。
- [恢复后截图](restored-pins.png)：保存版本及恢复后的 Agent 版本与组织默认技能状态。

`modelExecuted=false`：本验证不执行模型，不代表真实模型试跑或 devapp 部署验收。未拦截 API transport，未记录含会话 token 的 trace。

资源清理：runner 已终止全部自有进程组并移除自身 Next dist / 自动 tsconfig include；隔离外壳清理 Compose project `wsx-50ceecfd39ca8d637f33`。结束后精确 project 的 `docker ps -a` 返回空。
