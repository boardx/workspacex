# 原生本机启动与持久回读验收

最终运行源码：`c5db37767d588d1fff90ff861ac2d7a3a762710d`（原生启动代码为 `1d8b0ef75`，后一提交仅记录 Next 自动增加的隔离类型目录）。实际加载的 config／CLI／IPC／up 与测试前 SHA256 快照逐一一致，无运行源码漂移。测试源码与证据由后续提交收录，不能反称后续提交已重新启动过。

最终浏览器回归 **1 passed，退出码 0**，expected=1、skipped=0、unexpected=0、flaky=0、reporter errors=[]。这是一个包含两轮完整原生生命周期的端到端用例，不是一个 mocked start 测试。

## 实际通过的用户路径

1. 在显式独立、持久 data-dir 内，通过 `pnpm aidt:local start` 启动既有 PGlite／API／Web `next dev`／本地沙箱。没有 Docker、外部 PostgreSQL、供应商 fixture 或自动模型下载。
2. 执行真实 `health`，API `/healthz` 与 Web `/login` 都响应；连续新探测的 checkedAt 不同。AI 能力仍明确 unavailable／needs-install，不能由核心 health=0 推断 AI 或录音可用。
3. 用原生本地账号在浏览器登录，创建带 AIDT 标签的小组；填写第一步并点击“保存到小组”，真实 HTTP 回读 V1 与原文一致。
4. 打开全局成员插件，真实发送文字，等待服务器 stored 回执。
5. 使用真实 `stop`，等待原 owner 正常退出；`status=stopped`、`health` 退出码 1、七个完整显式 native 端口均可重新绑定，pgdata 保留。
6. 同一个 data-dir 重新 `start`，新 browser context 重新登录。原 projectId、阶段正文、修订及成员文字均从 UI／HTTP 读回，密码／加密 secrets 字节未重建。再次真实 `stop` 并检查端口。

最终另核全部 13 个隔离租约端口无监听、owner metadata 已释放、pgdata 仍保留。七个 native 端口全部显式覆盖且非默认端口，本轮没有默认端口自动挪移。测试没有删除数据库、重新 seed 一个同名项目或用浏览器 localStorage 冒充后端持久化。

## 命令

在仓库根运行；PATH 为本验收环境已经安装的 Node 22／pnpm 9。用户本机采用正常安装后的 Node 22／pnpm 9 与仓库启动说明，不使用这些 `/tmp` 路径。

```sh
env PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-ui-v3-bin:$PATH \
  AIDT_LOCAL_DATA_DIR=/workspace/scratch/aidt-local-persistent-acceptance/data \
  AIDT_LOCAL_OUTPUT_DIR=/workspace/scratch/aidt-local-persistent-acceptance/attempt-3/results \
  PLAYWRIGHT_BROWSERS_PATH=/tmp/aidt-playwright \
  WORKSPACEX_WEB_TEST_MAX_WORKERS=2 \
  pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
    pnpm --filter web exec playwright test \
      --config playwright.aidt-local.config.ts --workers=1
```

该配置不使用 fullstack smoke 的 webServer 或 seed fixture；测试直接调用可交付的 `pnpm aidt:local start/health/status/stop`。本地账号密码只从私有 data-dir 内部读取用于登录，未执行 credentials 输出命令，Playwright trace 关闭。

## 结果与性能边界

完整生命周期耗时约 4.7 分钟。最终轮创建 API 249ms，首次工作区显示 89.522 秒；第二次启动的该工作区 Next 编译 39.4 秒、HTTP 约 40.7 秒。这一重复使用了已有磁盘缓存，但新 dev 进程仍需编译，不冒称干净 cold benchmark 或即时恢复。前一轮隔离目录首次复杂页面编译实测 81.5 秒；没有预热隐藏真实首次等待，也没有将白屏／编译态当作 UI 成功。

本机工具采用 `next dev`，首次打开复杂工作区可能需要一到数分钟；health 仅证明核心 API 与登录页可响应。正式预构建安装包、macOS／Windows、真实手机键盘／IME、30 人或多机器课堂、真实 AI／Skill 执行、ASR／麦克风不在本次验收范围。当前实例未安装 Ollama／专用 Python venv／转写模型，不能声称已接入真实 AI 或语音。

## 前两轮失败保留

- 第一次：核心启动、登录及 AIDT 入口成功，但新工作区仍在 `next dev` 编译，60 秒路由断言超时。经真实 stop 释放全部租约端口，未称保存闭环完成。后续明确允许真实首路由最多等待 240 秒，未预热，也未删除断言。
- 第二次：阶段 V1 和成员文字保存成功，stop1 正常；第二次启动因磁盘仅 11.8GB，被既有 12GB doctor 门槛拒绝。未降低门槛。仅清理已经确认无服务使用、由诊断产生的普通 `.next` 缓存后，再完整重跑最终两轮生命周期；数据库及证据没有删除。

更早的容量不足也真实保留：最初仅 2.1GB，清理我方完成测试的生成缓存后 10.1GB；移除 pnpm 下载缓存未释放已被 hardlink 使用的包空间。负责人归档并退休旧的干净工作树、保留非生成证据后，doctor 才通过。没有删除已装依赖、用户修改或改变门槛。失败轮次不与最终结果拼接。

## 入库证据

见 [native-acceptance/manifest.json](native-acceptance/manifest.json)：

- 原始 [Playwright JSON](native-acceptance/playwright-results.json)、[两轮持久回读](native-acceptance/persistent-roundtrip.json)、[源码 SHA](native-acceptance/source-checkpoint.json)。
- [doctor](native-acceptance/doctor.json)、[health1](native-acceptance/health-cycle-1.json)、[health2](native-acceptance/health-cycle-2.json)。
- [stop1](native-acceptance/stopped-cycle-1.json)、[stop2](native-acceptance/stopped-cycle-2.json)、[13 端口与数据保留清理证明](native-acceptance/cleanup.json)。
- 两轮原生启动日志（仅清理 ANSI）、[失败尝试摘要](native-acceptance/attempts.json)。

日志／JSON 经当前本地密码、加密 secrets、已存在 session token 的精确值检查，发现并替换数为 0；未复制 data-dir、secrets、会话文件或 IPC token。截图只保留在本环境 scratch，已实际查看持久阶段、成员重登回读及 stored 回执三图；路径与 SHA 在 manifest 内，不上传 Library，也不把这些内部路径称为用户运行链接。
