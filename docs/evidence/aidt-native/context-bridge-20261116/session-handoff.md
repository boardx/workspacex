# 原生教学上下文桥接：当前交接

用户2026-11-16本轮原文：“批准上下文桥接方案，继续实现”。对应Backlog页末同束UI/用例/selector+receipt/两张隔离表，批准已存在，不再因该门阻塞；设计frontmatter不由agent代签。

HEAD基线7d1abe52bd30f621acaa6db7749c2077f82c3ece，worker/aidt-completion-20261116。A1原子受理，A2授权读取/快照，A3共享合同/迁移/AGUI/receipt，A4中性host/原生composer/AIDT producer，A5execute/provider真实hash派发，A6无费用真实PG/transport集成和后续E2E；root独占kernel DI、整体回归及交付。

./init.sh先因默认pnpm目录不存在失败；指定既有store后init退出0。harness tick仍因COORD_GATEWAY_URL缺配置失败，未伪造租约。GitHub外发此前被拒绝，不重试；不得因此称PR/CI绿。

当前源码未接通结果前不声称真实模型已使用材料。模型收费请求暂不执行；先做loopback/DB/ordinary回归。上一轮工程栈已正常释放，后续只用新合法隔离lease。私密配置和基线持久data仍在仓库外，禁止写进源码、PDF或一般日志。


## 本轮已实现及当前验证

- e9641c703：人工PDF改为内嵌TrueType中文字体，增加字体嵌入和空白内容页机械校验。用户明确看不到的是人工PDF；同一Library文件版本3已保存并回读25页正文，H01–H15/FR01–19/M01–M17均在；本机文字边界0、空白内容页0，用户端查看仍未反馈。原生可读替代页：https://chatgpt.com/space/page_b8000900cf9c8191980c5aceb2f71392 。人工结果和签字没有代填。
- b8e27049e：80个生产/测试文件实现已批准的selector→原子受理→Guarded精确来源快照→独立模型参考消息→真实派发journal→只读回执；root kernel DI和原生receipt UI实际接线。
- 696e5da06：独立审阅再发现S6/S3旧来源锁与head混用；真实parent+shared hook反例复现后修复，用已有lockedSourceStage和既有history端点精确回读，不引新契约。4文件68项绿。
- A6最终真实PG+实际Deep适配器本机HTTP22/22绿，供应商0，HITL command-only恢复/旧派发观察迟到不回退、撤权锁竞态、精确历史、普通Chat零AIDT副作用均覆盖。原环境/QA失败保留，来源hash与后续b8e提交10文件逐一一致。
- root Web同批122文件1060通过、4个既有plan-control跳过；全API/Web类型、完整API/Web lint、设计lint、testid6426、默认本地zero-egress静态检查均0；最终init退出0。controlled/静态/真实PG均不冒称真实供应商或课堂验收。

## 运行与后续（尚未通过不标绿）

A1的health-only stack-context-01在正常owner退出0后确认Docker/卷/13端口/lease均释放。当前按696e产品SHA启动全新stack-context-02，仍模型自执行关闭；实际模型和新浏览器尚待验收。A6另补coordinates-only浏览器检查与独立GET receipt，不再以自动browser材料正文当桥接；zero-fee unit及新health-only受理用例与paid ledger严格分开。

旧7-run付费总账保留，S1旧调用及其恢复历史未重置，本轮未批准新的S1或Design付费。后续拟仅旧剩余额度中的S2一次，但在root明确开窗前不能执行。新栈没有旧S5原型数据，不能用假id补S6真实Design验收。源码包仍需在当前验证收口后更新同Library身份；不要把旧下载包称为本轮桥接代码。

## 最终产品与本轮无费收口

产品+QA第一冻结741bc9f69693667868e88e780ff9a798e95d80ec：精确读取queued canonical runID（仅服务器RUN_STARTED后、按真实作者/clientID/捕获原话）、新请求清除旧receipt，Chat只用saved currentStage来源关系，不用未保存draft锁。A4 8文件89项及root最终125文件1103通过/4既有跳过，类型/lint通过。后续QA通用保存旧refs独立期望3小例另计，25单元绿不与1103相加。

context-03的741bc生产构建prepared-only真实浏览器1passed（4.7秒），独立HTTP来源回执与折叠/展开UI一致、原话与snapshot/ref/pin核对、真实取消通过；未组装/派发/消费模型。A1独立核physical/usage/credit/holds/active0，旧付费ledger未变；03也正常owner exit0清理，自有容器/卷/13端口/租约全释放。三个新工程栈都已停止，不是在线Demo。

用户先问人工PDF看不到正文，后问E2E是否全部通过及需要怎样支持。已明确：完整六步+SUM真实模型及课堂验收尚未全部完成。PDF改嵌入中文字体，最终同Library身份版本4共26页、H01–15/FR01–19/M01–18；保存后签字页真实回读，人工签字仍空。可直接阅读Page已同步当前H03/H10。

原7逻辑native预算仍保留旧S1消费1、剩6不重置；新增S1重新验证1个逻辑run、Design新隔离V1/V2最多2任务的具体提案见remaining-real-model-plan.md及Backlog页末，未获新增批准前不发新增任务。配置已取得，不再要求用户发密钥；仍需可月老师/学生人工试用与实际学生额度前提。无生产部署/合并/权限或余额变更，Github外发此前被拒未重试。
