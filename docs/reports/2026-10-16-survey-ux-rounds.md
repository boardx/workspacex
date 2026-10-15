# 问卷四轮交互体验 — #5779 / 父 #5777

工作树复用3120。初始fetch main `4cc236c75cdc09f16bbdff1ac76ce90d377222c8`；5758已MERGED，5770/5771/5772/5776动态读取仍OPEN，未把未合样例当当前产品。分支`worker/coord-survey-ux-rounds`，四轮顺序独立记录，最后汇总PR，不merge/deploy。

## R1 入口与输入（已自验）

真实基线：标准with-test-isolation API/PG/provider/seed与资源锁，前端为仅本机临时leaf Next dev，不修改共享配置，不增加CI编排；最终production配置仍收录同一survey-complete-flow spec。

走查路径：登录→空问卷列表→主创建/键盘空名称校验/取消焦点；独立AI导入→手动原文→同一物理文件首读受控错误→重选同文件。无生产用户任务、真实麦克风或付费模型操作。

- 空列表“新建问卷”实际两处深色主按钮，单入口契约浏览器与RTL均RED；修复仅移除空态重复按钮，保页头入口和模板导航。
- 文件首读通过FileReader error受控注入。同一物理文件再次选择后附件未恢复，浏览器RED，手动原文保持。修复仅捕获File后复位原生input.value，再执行原upload，保持后续文件/语音/生成契约。
- 首趟驱动冷编译/home等待及Next路由announcer多alert导致失败，不计产品问题；只预热本机dev入口并将alert限定AI region，未放宽业务断言或修改共享组件。

证据：[基线双入口](assets/issue-5779/r1/before-empty-list.png)、[基线读取错误](assets/issue-5779/r1/before-file-read-error.png)。新增取消焦点DOM测试先RED（实际焦点落body），再以owned弹窗关闭回调+真实header ref修复。成功导航不回抢焦点的negative回调测试也先RED；完成态ref仅屏蔽成功导航的焦点恢复，取消/Escape只向connected/interactive header恢复。未改globalDialog或业务pending门。

最终受影响UI35测试、targeted lint与真实浏览器2 tests PASS；Chrome已实走单入口、Enter打开、空名禁用、取消返回header、成功AI导航、同物理文件失败重选并保原文。运行过程中新增Escape分支没有被上一轮worker加载（截图缺失核对发现），未冒称通过；只补验稳定键盘case后1 test PASS（执行1m20s/cleanup1s），实际覆盖取消与Escape回header及成功AI导航。最终dev渲染43s/cleanup1s，未productionbuild。之前一次绿色执行等待标准互斥20m31s后正常释放；未旁路/另起栈。

实际已逐张检视截图：[修后空列表](assets/issue-5779/r1/after-empty-list.png)、[取消焦点](assets/issue-5779/r1/after-cancel-focus.png)、[成功AI入口](assets/issue-5779/r1/after-ai-entry.png)、[同文件重选](assets/issue-5779/r1/after-file-reselected.png)。仅合成数据与受控FileReader首错，不是OS硬盘故障/真人ASR或生产供应商证明。临时leaf不入库，标准production配置仍收录同spec。

## R2 核心流程反馈（已自验）

R1 checkpoint `ba139069ad200333138d0c4abe4f111f6ab023fc` 后重新fetch main，仍为初始4cc。真实路径：模板创建→编辑标题→真实PUT写入、仅短暂延迟响应→保存中/完成保持焦点→刷新读取持久化标题。首趟设计页冷编译未就绪是驱动问题；预热路由后业务断言RED，自动保存disabled输入使Chrome焦点失活。只把标题保存中disabled改为readOnly，未加载仍disabled，原API/锁/禁并发策略保持。

组件先RED（disabled断言，jsdom没有模拟浏览器失焦），修后37 UI PASS；真实浏览器RED→GREEN 1case（执行1m4s、清理2s），targeted lint PASS。截图：[修前焦点丢失](assets/issue-5779/r2/before-saving-focus.png)、[保存中保持焦点](assets/issue-5779/r2/after-saving-focus.png)、[刷新恢复](assets/issue-5779/r2/after-refreshed-title.png)。实际检视保存中截图。响应延迟为受控，本地真实API/PG保存；不代表生产延迟测量。

## R3 异常恢复（已自验，无产品改动）

R2完成后重新fetch main仍4cc。独立路径：AI导入原文→受控503→明确错误及保原文→重试并等待请求实际到达→取消→释放迟到响应且确认无提案弹窗→再次生成→预览仍需明确应用→返回输入保原文。没有自动应用/创建问卷。

最终稳定代码浏览器1case PASS（执行37s/清理1s），本轮未发现需要产品修复的问题，只新增验证。最终四个受影响UI文件72测试PASS，typecheck退出0。截图：[生成失败](assets/issue-5779/r3/generation-error.png)、[恢复原文](assets/issue-5779/r3/recovered-input.png)。503、延迟响应与提案均浏览器受控合成，证明前端恢复与显式应用边界，不是供应商真实故障或真实模型质量。

## R4 手机桌面、键盘和长内容综合

未开始。
