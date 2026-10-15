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

## R2 核心流程反馈

未开始。必须R1完成自验与checkpoint后开始，重新核main。

## R3 异常恢复

未开始。

## R4 手机桌面、键盘和长内容综合

未开始。
