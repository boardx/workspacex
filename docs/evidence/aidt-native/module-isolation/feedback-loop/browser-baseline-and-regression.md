# 原生浏览器反馈闭环：本轮截图、问题与复验

本轮先在 `c616680c598a53ab4cb0cc5df8f990ed644c7683` 的独立快照捕图，再由各 owner 修改主工作区；没有用旧轮截图或 CSS 覆盖冒充新代码。独立快照的 `@repo` aliases 指向快照，主工作区仍指向自身。测试使用真实隔离 API/PG、原生 WorkspaceX UI 和本地确定性供应商 fixture，不证明真实 AI/ASR 或课堂负载。

## 基线取证

- 新图目录：`/workspace/scratch/aidt-feedback-loop/baseline/`，62 张，覆盖六步 Chat、成果空态/已填/底部、报告、Dashboard 和成员文字插件，1280×900 与 375×812。
- 几何与键盘观测：同目录 `observations.json`。
- 额外稳定性探测：`/workspace/scratch/aidt-feedback-loop/attach/chat-readiness.json`，以及对应 `chat-settled-before-send-375.png`。
- Chat 最初仅等待 composer 的图片出现灰色骨架，**不接受为稳定空态证据**。额外探测实际记录：0 秒 loading=1/welcome=0；1 秒 loading=0/welcome=1，无 HTTP >=400 的注册/历史错误。欢迎已挂载，但实际图片仍未清楚显示正文；未取得完整 ancestor clip 读数，不能冒称根因已经确定。
- attach 的 `chat-populated-*.png` 处于 Agent run 进行中，**只代表 pending 状态**；不当作稳定回答验收。

## 首批五项与处理方向

| 问题 | 本轮真实证据 | 处理方向 |
| --- | --- | --- |
| 成果操作条遮挡字段 | 1280×900 第1步末字段 `{x:262,y:755,w:832,h:80}`，25/50/75/95% 实际命中均被底部操作挡住；第2、3步字段中心也被挡；第6步手机字段下部被挡。`05-step-1-outcome-bottom-1280.png`、`05-step-3-outcome-bottom-1280.png`、`05-step-6-outcome-bottom-375.png`。 | root 移除 sticky，主动作回文档流，复制降为次级。最终逐步重新测实际命中。 |
| Chat 教学壳占据手机阅读空间 | `02-step-1-chat-375.png`：成员/导航/保存/高级行到约 y350，native Chat host 405px 高。高度读数独立成立；骨架图片不能用来认定欢迎正文缺失。 | state 收紧教学外壳；保留原生 Chat 本体。 |
| 学生起手提示需稳定可见 | 欢迎正文 DOM 一秒后已存在，bbox `{x:89.5,y:384,w:196,h:62.75}`；仍不能从该图确认正文实际可见。 | Chat owner 在原生 empty-state 槽给每阶段短提示；最终必须非 loading、viewport 内、实际命中，不以 props/mocked Shell 通过代替。 |
| 新组缺显著起点 | `01-dashboard-1280.png`、`01-dashboard-375.png`：六卡同权且都叫进入对话，主说明强调本页草稿。 | entry 新组首步主 CTA、手机六行、真实服务器稿继续入口；不宣称学习完成。 |
| 非空候选可直接丢稿 | 桌面/手机均记录候选 3→2，无确认；`04-step-4-outcome-edited-375.png` 到 `06-idea-removal-375.png`。 | root 加非空移除确认，取消保留文字，确认才删。 |

## 六步检查状态

| 步骤 | 基线状态 |
| --- | --- |
| 1 理解问题 | 可进入；桌面末字段被操作条遮挡；手机首屏教学壳过高。 |
| 2 共情用户 | 可进入；手机首屏主要字段被挤到下方，桌面末字段被遮挡。 |
| 3 综合定义 | 可进入；桌面末字段被遮挡，手机输入区短。 |
| 4 创意 | 可进入；非空移除没有确认，手机操作条占据候选编辑区域。 |
| 5 原型 | 可进入；手机首屏选定点子输入与后续字段被操作区挤占，需要滚动。 |
| 6 测试迭代 | 可进入；手机末字段下半部被操作条盖住；报告单独捕图。 |

成员插件的真实 Tab→Enter 打开、选择器聚焦、面板内 Esc 关闭并还焦已作基线观测。真实输入法组合输入没有验收，不能把 Playwright 事件或 jsdom 测试说成真实 IME。

## 资源与运行边界

基线使用标准 isolation/heavy lock，canonical Playwright 拥有 API/Web/provider 生命周期。audit 测试完成截图后有界 hold，owner 通过本机 stop 哨兵退出；实测 stop 后标准 wrapper exit0，Compose `wsx-6030c13119bec123c735` 无剩余容器，13 个自有端口无监听。没有公共绑定、隧道或权限修改。

这个 hold 是**临时 fixture 验收环境**，不是持久小组工作区；停止或 TTL 会清理测试数据。没有把 localhost 称为用户链接，也没有交付未验证的新 runtime CLI。正常配置实例应复用现有 `pnpm --filter @repo/api dev`、`pnpm --filter web dev` 与开发模式说明，并由用户指定其本机或已授权测试环境。

## 最终复验要求

首次候选：`1c5bf9a5736509566fe91735c4b1c7a819b36547`（业务 `95d06a53e` 加本轮测试）。在主工作区重新 clean build，原3条真实全栈 + 新 audit，共4条；`AIDT_AUDIT_OBSERVE_ONLY` 未设、`verify=true`、`hold=0`。新 audit 等真正稳定 welcome 后捕图并做实际命中，逐步检查成果空/已填末字段，确认/取消候选删除，验证非 modal Esc 归属与草稿保留，并等真实持久 Agent 消息后才截有内容的 Chat。新栈与基线证据分目录保存。

该轮 **2 passed / 2 failed，exit1**，不能宣称4条通过。共享阶段与纯人类沟通真实全栈通过；native 停在旧 Dashboard 文案断言，新 audit 最后选到了原生 Chat 隐藏文本副本。failure 截图中的真实回答可见，已定位为测试选择器范围问题。失败日志、trace 与图片保存在 `/workspace/scratch/aidt-feedback-loop/final-results/` 和 `final/native-e2e-console.log`。

测试窄修保留编辑/未发送/真实存储断言，将旧文案换成当前“本页有未保存内容”；个人检查点 helper 按最近祖先 details 打开高级区，避免误选包含该 summary 的外层工具菜单；稳定 Dashboard 必须无 loading/error、出现首步 CTA 与6条真实保存状态；回答选择限定 native Chat 内实际可见节点，并增加80% viewport 与真实命中断言，没有调低几何阈值。

重验精确候选 `7aa8bd162929075b17198d93662d91f686524551`，基于最新 develop `9458932e466198416b81780da6284ea5f2b39c57`；相对旧业务候选只有 upstream 一行其它 E2E 变化和上述测试窄修，业务源码 blob 未变。当前独立新栈重新 clean build，结果待结束后追加；不拼接旧绿。

该轮 clean production build 成功，**3 passed / 1 failed，exit1**。新 strict audit 34 秒通过：稳定 Dashboard 已无 loading/error，首步 CTA 与六条真实空状态存在；六步成果末字段和欢迎正文的 25/50/75% 真实命中通过；非空删除取消／确认与成员插件键盘归属通过。共享阶段与成员文字仍通过真实双账号、API 与 PG 回读。证据独立保存在 `recheck-results`；`recheck/attempt-manifest.json` 明确不是最终全绿。

剩余 native 失败是冷跳转后 `openAssistant` 同步 `isVisible` 为 false，即等待当前默认 Chat 中已无的重复按钮。正式失败截图可见原生历史、已持久化回答和输入框，工具区收起，未发现高度为零的产品阻塞。最小测试修正先等真实 panel 或工具触发器就绪；正常路径再断言 composer 可见、80% viewport 和中心实际命中，预期权限错误两例保留原错误与隔离断言。该轮 populated Chat 截图虽有真实已存正文，但未显式等原生运行终态，不能宣称稳定完成；下一轮增加 `data-send-state=ready|disabled` 的 60 秒等待，不接受部分流作为最终图。

该栈结束后 Compose `wsx-8560021cd73f7d575032` 无剩余容器、13 个自有端口无监听，`recheck/cleanup.json` 为 `clean=true`。没有新增 runtime CLI，也没有将本机验收端口作为用户入口。

`f5d3a0e3e1b4c99a823b8058cd39d28549713a31` 再次标准新栈 clean build 后 **3 passed / 1 failed，exit1**。严格 audit 34.3 秒通过，包括真实 SDK 终态 `sendState=disabled`；这次 `12-chat-populated-*.png` 才接受为稳定回答。阶段与成员 PG 回读仍为 9／15 行，两个测试范围模型计数均 0→0。

新增的 composer viewport 断言暴露另一条路径：375×900、成果工具页、教学提示仍展开时打开 AI 侧栏，输入框 `toBeInViewport` ratio=0。失败截图中侧栏从页面下部开始，标题与教学头部占据大部分高度；源码中侧栏仅占 `overflow-hidden` 剩余容器。该问题与默认 Chat 严格 audit 的通过不矛盾，也不能以默认 Chat 图代替它。已将新截图与边界发给业务 owner，等待处理／复验；不通过收起教学提示、删除 viewport 断言或降低阈值冒称完成。失败证据位于 `accepted-results/project-aidt-native-*/`，该目录命名不表示验收成功；实际状态以 `accepted/manifest.json` 的 3／1 为准。该栈 `cleanup.json` 已确认 ps-a 无容器、13 端口无监听。

## 最终移动侧栏修复复验

业务 owner 将手机辅助 AI 层放到实际可视视口，桌面仍为内容侧栏，同一原生 Chat DOM 保留；Esc 只处理 AI 自己的事件。精确候选 `db828d5e2fbb6d8c233b4278c2ee50a9b892739b` 经标准 isolation 全新 API／PG／Next production build 后，**4 passed，exit0**，无 skipped、unexpected、flaky 或 reporter errors。不是拼接旧轮次的通过结果。

同一条原失败路径没有收起教学提示：375×900 打开辅助 AI 后，原生输入框和有草稿的发送按钮均满足 80% viewport 及真实中心命中；关闭后教学提示仍展开、成果表单保留，重开后未发送的 Chat 草稿仍在。AI 打开时通过真实点击打开全局成员插件，成员输入框满足 80% viewport 与中心命中；在成员输入框按 Esc 只关闭成员面板，AI 与其草稿保持。默认六步欢迎、成果末字段 25/50/75% 命中、候选移除确认／取消、普通非 modal 成员插件键盘路线也在本轮通过。

本轮 audit 有 61 条观测；全部四测试共 100 张新截图。375×812 默认 Chat host 从基线 405px 提升为 509px，欢迎正文真实可见。Chat 正文以真实 API 已持久化消息为准，且原生 `data-send-state=disabled` 后才接受最终截图。真实阶段 PG 回读 9 条修订、人类频道 15 条消息；这两个专用协作项目内 AgentRun／model request 均为 0→0，不能扩称整个测试系统没有 AI 调用。

最终证据根目录：`/workspace/scratch/aidt-feedback-loop/mobile-fix-results/`。清单、源 SHA／脏状态快照、完整日志、迁移文件 SHA 与清理证明位于 `../mobile-fix/{manifest.json,source-checkpoint.json,native-e2e-console.log,cleanup.json}`。清理实测 Compose `wsx-efcbde1cfa80db67ea36` 的 ps-a 无容器、13 个自有端口均无监听。strictLayout=true、observeOnly=null、hold=0。

我已实际查看本轮最终 Dashboard 375、六步末字段代表图、稳定 Chat 375、移动 AI、AI+成员插件、报告编辑及长话题图。重点路径如下（均相对截图根目录）：

- `01-dashboard-{1280,375}.png`：稳定六步及首步 CTA。
- `02-step-{1..6}-chat-{1280,375}.png`、`12-chat-populated-{1280,375}.png`：原生 Chat 空态及真正运行终态。
- `03-step-*`、`04-step-*`、`05-step-*`：六步成果空态、编辑态、底部字段。
- `project-aidt-native-AIDT-n-c2075--readonly-access-boundaries-seeded/aidt-teaching-mobile-start.png`、同目录 `aidt-mobile-ai-with-member-chat.png`：原失败路径修复及真实插件层级。
- `aidt-member-collaboration--b7ea2-d-isolation-remain-explicit-seeded/aidt-report-editor-{1280,375}.png`：真实共享报告编辑。
- `aidt-member-collaboration--2af06-idempotency-and-no-AgentRun-seeded/project-human-member-topic-{375,real}.png`：人类频道话题根摘要与滚动回复。

这证明本轮原生 UI 与真实本地协作闭环通过所列场景；没有证明真实供应商 AI 质量、ASR／麦克风、物理手机软键盘／真实 IME 或 30 人课堂负载。没有共享桌面或外部可访问的运行链接；临时验收栈已按 SOP 清理，不能把已停止的 localhost 或静态截图称为可用的用户工作区。
