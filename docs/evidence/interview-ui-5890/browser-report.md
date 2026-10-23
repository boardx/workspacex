# #5890 真实 Chromium 验证

产品 SHA：`fa90116ae14cccd00d12e9a2ca31002f711b9755`。

本轮实际启动当前 worktree Next，独占 `http://localhost:35890` / `.next-interview-ui-5890`，先以 curl 确认 intake HTTP200 再运行真实 Chromium。HTTP API 和 session 均为本地夹具；无真实登录、DB、模型或录音验证，也没有生产写入。Next RSC /itv/* 与静态资源放行真实服务器。

## 通过的16项检查

- 375、768、1280：统一输入框有可见“研究需求”标签和 Markdown 辅助说明；textarea border=0、radius=0，聚焦外框有 ring，语音/上传工具可见，无横向溢出。`browser-intake-focus-{width}.png`。
- 三档：访谈答案默认折叠；Enter展开、Space收起；选择采购专家自动展开且只显示采购内容；再次选择恢复全部并收起；无横向溢出。默认/展开截图 `browser-runs-collapsed-{width}.png`、`browser-runs-expanded-{width}.png`。
- 三档：受控延迟问题生成仅一处可访问status和一个spinner，无“尚无专家问题/请先生成”或“还没有问题”误导空态；返回后显示问题。`browser-outline-generation-{width}.png`。
- 三档：已有问题重新生成期间保留已保存问题文本，并且只有一个spinner。
- 初次 canonical HTTP挂起时非当前阶段为unknown skeleton，不画upcoming；解除后恢复completed。`browser-initial-unknown.png`。
- canonical读取503时显示可恢复步骤状态错误并保持unknown；重试后completed，未画全流程未完成。
- 已完成访谈从intake真实客户端切换analysis、canonical仍挂起时保留completed。MutationObserver记录所有阶段data-state，没有upcoming。`browser-completed-during-delay.png`和 `browser-results.json` 中 observed。
- 创建新修订时，前置intake/analysis仍completed，专家及下游重置upcoming。`browser-revision-reset.png`。

初始脚本夹具兜底误把Next RSC fetch当API返回JSON，导致客户端改为完整导航、route-local缓存清空，出现unknown。已查明并放行/itv/*真实Next请求，全部重新运行通过；未要求修改产品迎合夹具。保留 `browser-first-failure.txt` 作为夹具错误边界，不将它计为产品缺陷。

## 复现

仓库根目录：

```sh
NEXT_DIST_DIR=.next-interview-ui-5890 NEXT_PUBLIC_API_URL=http://localhost:35890 NEXT_PUBLIC_API_PATH_PREFIX='' pnpm --filter web exec next dev -p 35890
# 等 intake 返回200后执行
node docs/evidence/interview-ui-5890/browser-check.cjs
```

输出：`browser-results.json`、`browser-run.txt` 与本目录截图。截图均由本轮页面生成，未复用 #5843 旧截图。跨账号/组织或跨访谈隔离未在本脚本模拟，不声称该部分浏览器已覆盖，交由针对provider的测试与审查补充。

资源清理：最终脚本退出码0，Chromium由finally关闭；本人Next服务35890已SIGINT停止，lsof确认无监听；本次Next自动添加的tsconfig include已精确移除，tsconfig无diff。未启动Docker。证据文件未由验证agent提交，交由实现者统一commit。
