# 本地真栈会话实测：设计工作台（2026-09-24）

> 由 `scripts/local-session/design-loop-session.mjs` 生成。重跑方法见该文件头注。

## 环境

| 项 | 值 |
|---|---|
| 代码版本 | `03318b4c`（⚠ 工作区有未提交的改动——被测的不完全是这个提交） |
| 后端 | 本地版 `packages/local-runtime`（PGlite + 文件会话 + 真 API + 真 Web） |
| 浏览器 | Chromium（Playwright），1440×900，zh-CN，Asia/Shanghai；访客一步用 390×844 |
| 模型 | 替身模型 `scripts/local-session/standin-model.mjs`（本机没有可用模型；回写死的两页原型——**不是**模型质量证据） |
| 替身模型被调用 | 3 次：outline×1，screen#0×1，screen#1×1（产品按「骨架轮 → 逐页」的真实顺序调用） |

## 结果：18/18 通过

| # | 步骤 | 结果 | 看到了什么 | 截图 |
|---|---|---|---|---|
| S01 | 用本地账号登录 | ✅ | 登录后落地 /projects |  |
| S02 | 打开设计工作台（真栈 listMyProjects） | ✅ | 已有项目 | [s02-workbench.png](./s02-workbench.png) |
| S03 | 新建「会员下单」并自动开画 | ✅ | 画出 2 页：首页 / 下单 | [s03-drawn.png](./s03-drawn.png) |
| S04 | 详情页底栏「更新于」说人话，不是机器日期 | ✅ | 底栏：「本地用户 · 更新于 刚刚」 |  |
| S05 | 导出可点击原型：中文项目名转拼音（#3887） | ✅ | hui-yuan-xia-dan-prototype-2026-09-24.html |  |
| S06 | 导出设计文档 / 原型规格：同一套拼音规则 | ✅ | hui-yuan-xia-dan-2026-09-24.md · hui-yuan-xia-dan-2026-09-24.prototype.json |  |
| S07 | 导出当前页截图：页名「首页」也转拼音 | ✅ | hui-yuan-xia-dan-shou-ye.png |  |
| S08 | 属性面板：改了没按应用就点别处 ⇒ 自动应用、说出来、刷新后还在（#3882 R19） | ✅ | 提示「上一个节点（按钮「立即下单」）的改动已经帮你应用了；不想要的话用画布上方…」；刷新后仍是「马上下单」 | [s08-auto-applied.png](./s08-auto-applied.png) |
| S09 | 分享：发布拿到链接；访客（无登录）打开只读页 | ✅ | 访客（手机宽度、未登录）看到「会员下单」 | [s09-guest-mobile.png](./s09-guest-mobile.png) |
| S10 | 取消发布先确认；「算了」不收回，确认后访客打不开（#3882 R20） | ✅ | 收回后访客看到「这条分享链接打不开：可能已经被取消分享，也可能链接不完整…」 | [s10-unpublish-confirm.png](./s10-unpublish-confirm.png) |
| S11 | 工作台：删除项目先确认，「算了」不删；卡片时间是人话（#3882 R18） | ✅ | 卡片写「改于 刚刚」；点「算了」后项目还在 | [s11-delete-confirm.png](./s11-delete-confirm.png) |
| S12 | 悬停反馈：访谈页未选中的页签悬停变成正文色（#3894） | ✅ | idle rgb(95, 95, 103) → hover rgb(20, 20, 23) |  |
| S13 | 手机宽度（375）打开设计详情：画布读得了字，不是一张缩略图 | ✅ | 画布缩放 0.87（读得了字；装不下的部分竖着滚） | [s13-phone-detail.png](./s13-phone-detail.png) |
| S14 | 提反馈弹窗点「语音」：本机没开通转写时不给死路「重试」、说明不被截断 | ✅ | 「这里还没开通语音输入当前环境尚未配置语音转写服务，暂时无法使用语音输入，请手动输…」；「重试」按钮 0 个 | [s14-voice-not-configured.png](./s14-voice-not-configured.png) |
| S15 | 运营收件箱打得开：系统异常一路读不到时只丢那一路（#3921） | ✅ | 收件箱正常打开；系统异常那一格如实说「这次没读到」（本地版预期） | [s15-inbox.png](./s15-inbox.png) |
| S16 | 品牌色与字体：输入 #FF5A1F、选衬线体，刷新后还在（对标 R1，#3933） | ✅ | 刷新后画布根仍是 #FF5A1F + 衬线体（真 PGlite 上的 tokens 列） | [s16-brand-font.png](./s16-brand-font.png) |
| S17 | 批注存在服务端：钉一条，换一个全新的浏览器（空存储）打开同一个项目还看得到（深度 S2，#3988） | ✅ | 另一个浏览器（空存储）打开同一个项目，看到「真栈批注 muf0f1kw」和它的钉（真 PGlite 上的 design_project_comments） | [s17-comment-other-browser.png](./s17-comment-other-browser.png) |
| S18 | 批注讨论：回一句、标记解决再重新打开、删掉批注连同回复（深度 S3，#3988） | ✅ | 回复刷新后还在、重新打开的状态落了库；删掉带回复的批注成功（真库外键级联，回复表不授 DELETE） | [s18-comment-thread.png](./s18-comment-thread.png) |

## 发现

- 无

## 浏览器控制台报错

```
Failed to fetch RSC payload for http://127.0.0.1:3100/projects. Falling back to browser navigation. TypeError: Failed to fetch
    at fetchServerResponse (webpack-internal:///(app-pages-browser)/../..
```
