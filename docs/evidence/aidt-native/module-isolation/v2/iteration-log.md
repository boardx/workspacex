# V2 测试—修复反馈记录

以下是开发与自动化检验记录，非五位真人专家、真实学生试教或真实模型访谈。完成状态以各条实际命令及最终统一验收结果为准。

| 轮次 | 测试/审查发现的问题 | 修改 | 回归证据 |
| --- | --- | --- | --- |
| 1 | 新需求仍只有附件预览，容易沿用旧PDF | 接收用户完整Markdown，提炼FR15–19；保留待确认细化和此前录音后排边界 | `docs/requirements/aidt-v2-delta.md` 逐项对应用户文本 |
| 2 | 第一阶段缺少选题价值与观察/抱怨/猜测，确认易被误当事实 | 原始命题后先展示反思；多来源、未知允许；编辑撤确认 | `aidt-problem-reflection.test.tsx` 11项通过；实际保存由最终原生验收另证 |
| 3 | 画像只归纳共性，暂无分支可能带出隐藏旧发现 | 意外发现先于画像；统一parser核对引用；none formatter排除旧字段 | `aidt-surprise-reflection.test.tsx` 20项通过 |
| 4 | 分类与投票混淆，跨标签可能被算作多个点子 | 多标签及理由；分类与selectedIdeaId分离；描述单按原idea生成 | helper/UI/StageOutput定向34项通过 |
| 5 | 没有明确问题也能进入原型生成路径 | 验证问题+匹配确认才开放教学Design；原型能力边界展示 | `aidt-verification-loop`与question组件；旧空稿可进入Design测试改为应禁止 |
| 6 | 测试原问题可能跟随第5步后续编辑，事后换题 | 显式带入已保存S5快照；原始问题/看法/原型/历史版本固定；原生前序引用固定到历史revision | `aidt-v2-shared-round.test.tsx` 实际hook回归通过；非后端语义真实性验证 |
| 7 | 旧流程默认只能修原型，未变/证据不足被误当无效 | 认识变化有效分支；可返1–5或未决定；回前四步无需新版本 | `aidt-test-reflection`、`aidt-round-navigation`、`aidt-next-round`回归 |
| 8 | 新字段在保存摘要/交接/报告中遗漏，none-only可能被当空稿 | readable V2投影统一汇入summary/handoff/report；不展示JSON；新字段单独填写可保存 | `aidt-v2-report.test.ts`与shared-round回归通过 |
| 9 | 旧对话pin保留旧Skill，升级包不代表旧会话已升级；多轮历史缺查看入口 | 不可变1.3新包；显式另开新版对话，不改原pin；增加分页只读历史与新轮明确确认 | Skill32项+API类型检查通过；宿主/历史测试结果见最终verification |
| 10 | features未进入Tailwind扫描，标题和悬浮Chat响应式样式实际缺失 | 加features扫描，设计lint同纳入；实际CSS回归及桌面/375px浏览器计算样式验证 | `tailwind-features.test.ts` 1项通过；原生构建与浏览器结果待最终验收 |

所有失败会保留输出，不把仅mock的步骤称为实际原生/真实模型验收。若统一验收发现新问题，继续修复并记入末尾。

交叉复核补充：修正第6步原始说法/行为/问题编辑后未撤确认；修正第5步换点子未撤问题确认；意外发现发送时带实际卡片版本，固定第2步历史来源；返回旧轮次在第6步head变化后按授权历史精确读取。对应新增UI/hook回归已通过。最终冻结运行49文件481项AIDT Web测试全绿；设计lint含features、Web类型检查通过。真实本地构建与两次停启结果另记。

最终原生验收：运行时代码b7256029d，测试位置修正f11304c715。新构建234.970秒成功；复用时严格检查同API、同源码与产物回执，没有重写或降低guard。attempt1因共享依赖文件缺失失败，按lock完整性恢复Next/React；attempt2构建成功但脚本在S5 exact label定位中断；用真实Chromium最小DOM确认exact标签0而textbox角色1，改test-only角色定位与动作超时后，attempt3实际1/1通过、无skip/flaky、两次start-stop与新登录精确回读。13端口按真实Node绑定语义全部释放，无遗留owner或租约，PG保留。真实模型/原型生成/研究采集未验，不能把自动化教学示例当作课堂证据。脱敏原始结果见native目录。
