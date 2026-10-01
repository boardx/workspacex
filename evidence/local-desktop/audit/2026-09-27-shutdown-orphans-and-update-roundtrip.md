# 退出留孤儿 → 离线更新换不上界面：实机往返（#3872 R21）

实测 SHA：wsx-r11 工作树（claude/local-r20 + 本 PR 的 child-ledger/信号处理 + 模型探测挪位），
产物 `apps/desktop/release/mac-arm64/WorkspaceX.app`，userData `/tmp/wsx-rt`，M 系列 16 GB。

## 先写下的可证伪预测
- P1 SIGTERM 后 ~15 s 内五个端口（3100/3200/2024/11435/55432）全部放开，日志有 `[shutdown]`。
- P2 装 0.3.0 包后探针 `/update-probe.txt` = 200，回滚后 = 404。
- P3 三次行数一致且非空。
- 若 P2 在端口确实干净时仍 404 ⇒ 更新机制换不到界面层，设计要改。

## 修之前（同一台机器，同一个脚本）
- 更新后探针 404。**不是**更新机制坏：`lsof` 显示占 3100 的 next-server 启动于 00:01:12Z——
  第一次启动的那个。脚本对主进程发 SIGTERM，api/web/deep-agent/ollama 全成 ppid 1 孤儿；
  后两次启动都「端口被占用」失败，探针量的一直是旧版。
- 脚本自己也有两处假判据：`start` 只看「3100 有人应答」（旧版也应答）；`stop` 用
  `pgrep …MacOS/WorkspaceX | head -1`，api 子进程（ELECTRON_RUN_AS_NODE）也匹配。

## 修之后
```
① 原装版首次启动   探针 404（期望 404）  SIGTERM 后 2s 内全部收干净
   行数 organizations 3 projects 0 … agents 4 skills 22 canvas_templates 20 agent_runs 0
③ 装 0.2.0 → 0.3.0，校验 79166 个文件   探针 200（期望 200）  SIGTERM 后 2s 内全部收干净
④ 同一个包再装：拒绝「这个包就是当前版本 0.3.0」
⑤ 回滚 0.3.0 → 0.2.0                   探针 404（期望 404）  SIGTERM 后 2s 内全部收干净
⑥ ✅ 三次行数一致（且非空）
⑦ kill -9 主进程 → 残留 3100 2024 11435 → 再开：
   [up] 上一次没有正常退出，收掉了残留的：ollama、skill-sandbox、asr-gateway、deep-agent、web
   [model] qwen3.5:4b-mlx 就绪，首个 token 往返 276 ms
   [boot] ready（21 s）
   SIGTERM → [shutdown] 收尾完成，用了 8532ms；端口全空
```
P1/P2/P3 全部成立。

## 顺带揪出的
- 模型探测在选模型之前：每次启动 10 s 后报「模型 qwen3.5:4b 404」（包里只有 4b-mlx）——另一个 PR。
- 安装版日志：`SKILL_SANDBOX_MODULES_DIR 未配置`——Word/PPT/Excel/PDF 产出静默全灭——另一个 PR。
- 收尾 8.5 s：有子进程不理 SIGTERM，等到 8 s 的 SIGKILL 才走——下一轮。
