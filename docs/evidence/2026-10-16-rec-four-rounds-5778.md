# 实时转录四轮交互验收

Refs #5778，父 #5777。基线 main `4cc236c75`；现有工作树复用，逐轮 fetch main。共享 #5776 尚未合入基线，其创建弹窗焦点/页头修复由研究 owner 独占；本轮未改共享文件。

实际 Next dev / Nest API / PostgreSQL / Redis / MinIO，标准 with-test-isolation 资源准入，合成账号与数据。隔离 ID `run-mv9x2dhu-7262de8c-35a395b53f48`，compose `wsx-35a395b53f48e5c7662b`。浏览器从真实登录进入 `/rec`，没有 API 拦截或页面 fixture。

| 轮次 | 实际路径与发现 | 最小修复与提交 | 验证 |
|---|---|---|---|
| R1 | 列表→创建：空白名称禁用、标签 Enter 提交→进入工作区→键盘/双击改名→返回。改名取消/保存后焦点落 BODY | ref + 关闭后恢复到连接且可用的标题按钮；`a01c93200` | 新测试先红1/16通过，修复后17 PASS；真实取消 focus-visible=true，保存后焦点回标题，名称和标签真实保留 |
| R2 | 打开记录→编辑：textbox无名称、焦点落BODY；保存多段正文→刷新→重开保留；回列表创建提示仍称正在进入 | 正文可访问名称/自动聚焦，关闭回编辑按钮；创建notice只表达已完成；`f3d001433` | 新测试先红1/17通过，修复后两文件47 PASS；真实保存后焦点rec-live-edit，原文/换行读回 |
| R3 | 仅测试页临时断网→保存：草稿保留但Promise拒绝未捕获触发框架error；恢复网络重试。另断网连接→正在重连→停止取消→恢复网络 | catch保存失败，保留draft与重试，局部/上层错误共用单banner；`4a83f5ed0` | 新测试先红1/18通过+1 unhandled，修复后19 PASS；实际断网仅一错误banner、草稿保留，恢复网络保存成功并清错；取消重连正文保留 |
| R4 | 375/768/1280，1058字符12段+长链接+连续英文标识；原375正文宽301/scroll3720 | 只加break-words，不改文本；`36a266810` | 修复后正文client/scroll301/301、602/602、1114/1114，各尺寸原文长度1058；375末尾bottom807<nav844；键盘textarea→取消→保存focus-visible=true，save bottom701<nav844，取消回编辑 |

## 截图与原始测量

截图目录：`/Users/shenyangjun/.codex/visualizations/2026/10/10/01a12491-9861-7c11-9407-28b68f4e0ec3/rec-four-5778`。各轮文件：
- R1：`r1-before.png`、`r1-focus-fixed.png`
- R2：`r2-before-editor.png`、`r2-editor-fixed.png`、`r2-saved.png`
- R3：`r3-before-save-error.png`、`r3-save-failure-fixed.png`、`r3-retry-saved.png`、`r3-reconnect-cancel.png`
- R4：`r4-before-long-375.png`、`r4-before-unbroken-375.png`、`r4-long-{375,768,1280}.png`、`r4-long-bottom-375.png`、`r4-keyboard-save-375.png`
- 测量：同目录 `geometry.json`，并附入本目录JSON。

## 边界与资源

没有真实麦克风权限/音频/付费ASR/供应商成功验证；断网连接在票据获取前失败，已有connecting cancel/stop settling/reconnect/unmount回归继续保护。长文本为合成数据，不改ASR标点。热更新加state导致旧编辑视图重置后，已刷新重新完整执行R3复验；不能把开发HMR视为生产草稿持久化保证。

断网模拟已恢复，viewport已reset，测试业务tab已关闭。首次在Web启动完成前产生一个连接拒绝临时页，交由默认临时tab清理。Web/API/本地ASR服务停止，独占compose down；未触碰他人资源。

最终命令结果见PR与issue收据；root按最终exact独立验收，不自行合并部署。

独立静态审查发现保存失败后取消编辑的本地错误可能残留；追加取消清除局部错误，回归先红1/19通过，再执行最终验证。父层ASR错误不在取消时清除。

## 最终验证收据

- `./init.sh` 快速路径退出0（`/tmp/rec-four-init.log`）。
- 转录两文件49项PASS（`/tmp/rec-four-final-tests.log`）；类型发现新增测试的错误exact属性，改成精确名称正则后工作区20项PASS（`/tmp/rec-four-workspace-final.log`）。共享5项已在本轮组合套件通过（`/tmp/rec-four-tests.log`，该次新增取消错误回归前共53项）。
- `pnpm --filter web typecheck` 最终退出0（`/tmp/rec-four-typecheck-final.log`）；`pnpm --filter web lint` 退出0（`/tmp/rec-four-lint.log`）。
- 独立静态增量审查334020ca7：先前P2已解决，无新增发现。后续仅测试选择器类型修正与本文收据。
- 独占compose容器查询为空；API24141/Web25141/ASR29141无监听。
