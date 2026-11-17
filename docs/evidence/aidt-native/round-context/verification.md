# 实际验证与边界

运行时代码：39a35463817175ed02bef0d810fdcb187dc7e841（含导航修复 f436f1065）。均为隔离分支本地提交，没有发布、合并或修改权限。

| 检查 | 实际结果 |
| --- | --- |
| AIDT Web | 50文件501项通过；4个直接相关文件83项通过 |
| Local Runtime | 7文件38项通过；真实PGlite、队列所有权、RLS、A+B持久化与停机屏障 |
| 类型与规范 | Web、Local Runtime typecheck退出0；变更Web文件ESLint及设计检查退出0 |
| 新构建 | 241.520秒退出0；构建未改变PG摘要；未复用旧指纹产物 |
| 原生E2E | 完整1例通过；0 skip、0 unexpected、0 flaky；整条命令360.583秒（含build） |
| 真实浏览器 | 第6步保存反思，回第1步，等待原生线程，经过交接/Chat/成果及刷新仍保留原返回轮次和原因 |
| 双停启 | 两次就绪14.165秒、13.869秒；stop命令和原启动进程均退出0；新登录逐阶段、报告和人类消息精确回读 |
| 清理 | 原生owner停止，13端口独占bind均可用，PG与私密数据保留；截图与trace未交付 |

## 可复现检查

仓库根目录，Node22、pnpm9.15：

```sh
pnpm --filter web exec vitest run tests/ui/project-aidt-chat.test.tsx tests/aidt-board-return-navigation.test.ts tests/ui/aidt-resource-navigation.test.tsx tests/ui/project-aidt.test.tsx
pnpm --filter web typecheck
bash apps/web/scripts/lint-design.sh
pnpm --filter @repo/local-runtime exec vitest run test/pglite-queue-shutdown.test.ts test/pglite-queue.test.ts test/pglite-queue-ownership.test.ts test/pglite-server.test.ts test/aidt-cli-lifecycle.test.ts test/aidt-local-lifecycle.test.ts test/aidt-pglite.test.ts
pnpm --filter @repo/local-runtime typecheck
```

50文件501项的冻结选择命令同前次V2证据 verification.md，实际输出 web-tests.txt。原生验收通过标准 with-test-isolation 取得全新13端口租约，命令及配置见 native/execution.json。只使用专用持久测试目录，非日常账号或生产环境。

## 失败未抹掉

第一次因未指定已安装Chromium目录失败；第二次缺Next安装文件；第三次新构建及返回轮次通过，但stop原进程退出1，因此整条失败；加入数据库关闭屏障后，第四次仍因共享Next/React依赖目录缺文件失败。仅按官方tarball、与锁文件相同SHA512恢复缺失文件，未改版本、未覆盖已有差异，目录缺失的外部原因未确定。第五次用最终代码新构建并完整双停启通过。之前失败的关键证据保留，不把单条成功或截图当整体通过。

## 未计为完成

导航参数只是历史引用，不赋予Board/项目权限，不确认材料真实性。真实Board后端往返尚未因本轮组件链接检查而计为端到端通过。模型生成请求为0，AI教学质量、真实原型与图像生成、访谈授权/采音/ASR、约30人课堂及macOS/Windows实机未验收。访谈录音和语音房按用户决定另排。成员文字首轮A+B双账号验收见已有证据；本轮验证其本机持久回读，未重复声称新的双账号课堂试点。

协调网关未配置，harness tick失败；没有声称协调租约或CI通过。GitHub外发此前被拒绝，本轮不重试；没有新PR或线上演示地址。本机试用按 START-HERE.md。
