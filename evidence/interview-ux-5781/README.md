# 用户访谈四轮交互体验（#5781，Refs #5777）

目标：四轮不同路径实际走查→具体问题→最小修复→复验，保留业务字段、权限、模拟证据与原生 Skill 链路。

## 逐轮事实

|轮次|实际路径与发现|最小改动|证据与边界|
|---|---|---|---|
|R1 入口输入|历史页→新建：默认名 caret=5/5；直接键入追加默认名|仅默认名自动全选；自定义输入不全选|dev/r1-before 与 after；真实 API 创建进 intake。先红后绿 UI；首次 HMR 尚未更新的失败不算通过|
|R2 核心流程|保存专家/问题→添加问题：焦点仍在添加按钮|只对本次新增问题聚焦并选中占位，普通编辑不抢焦点|dev/r2-before active=添加问题；真实 UI 编辑→API保存→刷新重读。dev/r2-after 截在初始化 disabled 瞬间，只证明内容重读，不作为空闲状态证据|
|R3 异常恢复|明确受控 HTTP503：提示 raw DEPENDENCY_UNAVAILABLE；输入可重试|短人话提示，底层错误/请求/幂等标识不变|dev/r3-before 是受控注入，不是真实供应商事故。开发 HMR after 仍旧文案而失败，如实保留；随后标准生产构建真实通过人话提示、输入保留、同 requestId 重试真实API创建|
|R4 综合|标准生产首次375/768/1280走查：报告/专家无横溢，手机问题输入却被按钮挤到仅几个字；人工截图推翻自动无横溢即体验合格|问题 textarea 自动换行、高度上限320px；窄屏局部按钮下一行。Enter不插入换行，IME提交保留，粘贴CR/LF去除与原单行input相同|最终 main 组合标准生产浏览器复验通过：375/768/1280 每宽真实编辑长问题、保存并刷新重读；wrap/width/height/Enter 与无横溢断言通过，见 final-production；目标UI先1red5pass后53pass（含编辑组）。不把自动PASS冒充人工体验通过|

## 集成

原 `codex/interview-ux-four-rounds` 完整保留 source/evidence checkpoints。前轮 #5770 尚未合并，依主协调要求在同一 worktree 新建 `codex/interview-ux-four-rounds-main`，从最新 main `4cc236c75cdc09f16bbdff1ac76ce90d377222c8` 仅 cherry-pick 本轮变更。R1 在 main 原 autoFocus 上增加仅默认值 onFocus select，未复制前轮紧凑布局/焦点恢复实现，其余无冲突。当前 PR 不重复交付 #5770 的样式或证据；该依赖单独保留。

最终已验收源/测试 SHA：`618dbff0c599716d2d827b89ec9676bf4b93a6bf`。

## 验证与限制

- main 组合：82 UI 测试通过（4文件），target eslint、web typecheck 通过；init.sh 快速健康路径通过，未声称全仓验证。
- 开发只用于逐轮观察；临时配置、等待标记逻辑和自动 tsconfig include 已删除，未提交新框架或修改标准超时。
- 开发环境首轮冷 /home 编译超默认5s断言失败；第二次实际新源码 HMR 尚未送达而失败；第三次R1/R2实际通过，R3 after旧文案失败后已标准清理。该流程占重e2e锁过久，收到主协调提醒后停止跨开发等待，后续仅实际执行时准入。
- 一次 typecheck 与标准构建清理 dist 并发引起 TS6053，未算通过；构建结束后顺序重跑通过。旧 UI 用例要求 raw reason 的断言随预期人话提示更新，保留其输入/幂等断言。
- 标准生产首次运行1/1通过，PG agent_runs/model_request_starts 均0→0，模型命令[]；随后人工发现R4新问题，必要复验新修复与main组合。不是重复四次同套测试来凑轮数。
- 所有数据为隔离合成数据；真实登录/API/PG，只有明确503响应为受控注入。未点击PDF/Word生成、未调用模型、未启用真实麦克风、未操作生产任务。
- 文件按钮可用不代表原始报告导出问题已经全部验证；Word真实生成终态与专业版式仍在原任务边界，未以本任务替代。
- 不更改feature状态、不合并/部署、不关闭父单。仅清理本任务所有栈，保留用户指定worktree。

## 最终实际结果

最终源/测试 `618dbff0c599716d2d827b89ec9676bf4b93a6bf` 经主协调独立SourceAccept（另独立35 UI PASS）。标准隔离生产构建+真实浏览器 1/1 PASS，运行3m33s、标准清理1s，总计3m34s；PG runs/requests 0→0、commands=[]。未调整标准配置或超时。final-production 所有PNG为原始浏览器截图，未裁切改写。

375长问题框实际宽239px、高320px、scrollWidth=clientWidth=239、whiteSpace=pre-wrap；内容超320px会在输入框内纵向滚动。截图捕获编辑焦点附近，局部按钮/页面操作区可在下方，需要向下滚动；用例随后真实点击保存并刷新成功，不声称按钮始终固定可见。长报告截图为焦点到Word入口后的滚动位置，顶部标题可能已经滚过，不作为顶端状态截图。R3重试后的intake截图可能仍在初始化，只证明导航到真实新建资源，不声称模型生成或后续任务完成。

保留已失败开发运行、旧raw断言与生成types竞态的事实，未以删除断言/改标准timeout/伪造供应商成功消除失败。全部自有栈已随隔离wrapper清理；worktree按用户要求保留。
