# AIDT 服务端上下文：集成验收设计

状态：**用户已批准桥接；真实PG/实际适配器本机HTTP集成22项通过，S2真实浏览器仅受理/prepared回执复验通过，供应商调用0。** 本文不代替或修改人类签核。浏览器组装/派发及真实供应商链仍待后续验收，不把prepared、客户端wire或本机协议记录服务当模型消费证明；本轮已收口、不开启收费执行。

## 目标与证据层级

1. 用真实隔离DB中的阶段稿、修订、项目成员关系、原生线程与Skill挂载准备数据。
2. 真实应用路径走到实际`ModelCall`适配器入参边界；只读记录可信教学快照摘要/哈希、source revisions和call计数，不修改返回值、不保存私密prompt。
3. 正向消费证明与负向零调用证明分开：无收费拦停/观察边界的集成测试**不算真实供应商/Agent端到端通过**。人签核及实现后，在既有预算内使用一次计划中的S2原生运行验证真实供应商链路，不重发已收费S1。
4. 只读receipt的载体、字段、规范化/哈希方法与持久化责任待设计确定，测试复用已批准的单一实现。没有获准可读证据时明确阻塞，不用wire marker代替。

## 数据准备

仅使用一次性隔离测试组织与新建合成组甲/乙；所有标识含测试UUID。由实际授权的学生编辑者保存：

| 数据 | 准备 | 不可混淆的标记 |
| --- | --- | --- |
| 甲第1步 V1 | 初始命题、猜测来源、来源详情与不确定项，显式保存 | `DB_A_S1_V1_<uuid>`，不出现在发送prompt中 |
| 甲第2步 V1 | 模拟提纲/原文/学生解释，实际保存；引用甲S1 V1 | `DB_A_S2_V1_<uuid>` |
| 甲后续head V2 | 仅在接受/暂停后由有权编辑者另存，V1保留 | `DB_A_NEW_HEAD_<uuid>` |
| 乙私有稿 | 同账号/其他账号均按用例归属，不能混入甲 | `DB_B_PRIVATE_<uuid>` |
| 假浏览器材料 | 仅置于未经信任的body.context/state或额外字段，不能写入DB | `FORGED_CLIENT_ONLY_<uuid>` |
| 原用户消息 | 从已发送wire读取最后一条human text，包含换行/中文/符号 | 与durable human row逐字比较，不把教学上下文拼入用户正文 |
| Skill | 读取实际启用目录与线程临时挂载中的明确version pin | 记录skillId/versionId，不能拿最新catalog版本覆盖旧pin |

普通学生0余额不能用来“证明”来源拒绝：零调用用例需先证明它到达授权/来源检查层，而非先被额度拦截。若需合法余额的非owner协作者，使用已有funded账号并仅在本测试组添加实际collaborator；不增额度、不改组织角色/plan。课程/学生权限与模型技术actor分别报告。

## 待实现用例

| 编号 | 操作与断点 | 必须观察到的结果 | 成功不能仅靠 |
| --- | --- | --- | --- |
| CTX-P01 · DB正源 | 学生先真实保存甲S1/S2 V1；原prompt不含独有marker。由甲已挂本阶段Skill的原生Chat提交一次请求，旁路观察实际ModelCall入参 | 合法DB marker位于已验证教学材料槽；project/stage/revision/pin与快照一致；原human正文逐字保留；只读receipt/hash能与独立读取的同版快照对上 | 浏览器UI/wire出现marker、context对象非空、通用Skill数>0 |
| CTX-N01 · 伪造context正文 | 在同一授权请求的客户端context/state额外放FORGED marker、假“已验证”声明；DB不含它 | 不进入可信教学材料/实际ModelCall对应材料槽；DB marker仍按真实快照传入；伪造声明不升级为服务端事实 | 仅删前端预览文字或只检查JSON顶层名 |
| CTX-N02 · 跨组source | 甲线程请求乙project或乙阶段修订作为教学来源 | 按已批准错误语义拒绝；ModelCall计数0；无跨组正文/来源泄露；不默默改为甲或最新head | 模型自己拒答或无余额402 |
| CTX-N03 · 错阶段/错pin | 甲S1请求与挂载empathize或其他版本冲突；分别测试无pin、错误pin与其他Skill存在 | 验证明确阶段Skill的确切version；不因“有任意Skill”放行；未通过时ModelCall=0 | catalog名称相同、skillVersionIds长度>0 |
| CTX-N04 · 未知/过期source | 明确引用不存在修订、无法读取历史或被撤权来源；不允许用最新版本补齐 | 拒绝/明确缺口行为以签核设计为准；不偷偷改用head；需要完整必需来源的run在模型前拒绝且计数0 | 返回空数组、模型编补缺失 |
| CTX-N05 · 撤权竞态 | 先读合法源；只在测试拥有的暂停点等待；owner用真实成员接口撤回本测试刚授予的collaborator，再释放接受流程 | 接受/快照与授权按设计保证一致；旧读结果不能越权进入ModelCall；拒绝路径call0，无失效快照成功回执 | mock403、全局GRANT/REVOKE或改组织角色 |
| CTX-I01 · 同输入幂等 | 同actor/thread/client message标识及同源快照重放 | 同一human row、同一run及同一上下文快照；不新增模型调用/hold/账本请求 | 仅内容相同但ID不同 |
| CTX-I02 · 同标识换context | 已接受标识重放时改变project/stage/明确版本/pin之一 | 409冲突（root明确要求，细码以签核设计为准）；原run/原快照不变；不新增调用 | 覆盖原快照或将修改当正常重试 |
| CTX-I03 · 正文不改写 | 提交实际wire最后human原文，包含多行与标点；教学数据经独立槽传递 | durable human text逐字相等；材料/规则不偷偷拼入原文；重放仍同message/run | 只比较trim后或摘要后正文 |
| CTX-R01 · 恢复旧snapshot | 一次计划中的真实run接受V1后在confirm_task_intent暂停；另一有权编辑者保存新head V2；只审阅原生卡并继续同run | 恢复仍用原已接受V1/pin/hash，不能拿新head V2替换；没有新human消息/新run；V2仍可在下一次显式请求使用 | 当前UI显示V1，而模型实际重读V2 |
| CTX-R02 · 重登恢复 | 暂停后关闭浏览器/重登录，打开同thread/run，经原生卡明确修改/确认一次 | 权限重新核对；使用原snapshot；原待确认记录与选择留痕；不自动/永久授权 | 服务端API直接approve或重新发送用户消息 |
| CTX-R03 · S6旧源优先 | S6冻结问题指向S5 V2/真实P1，当前S5已是V3/P2；显式为本轮学习组装材料 | 以本轮已保存snapshot与明确历史引用为准；新head可标为另有更新但不顶替原题/先前看法/P1；来源回执能区分本轮旧源与当前head | 把“所有最新阶段marker都在wire”当正确；从当前head断言原轮次数据 |
| CTX-S01 · SUM来源 | SUM使用独立总结线程与总结pin；明确读六步当前版本/有界历史，教师点评无来源 | 模型入参是实际已保存源与明确缺口，含旧轮次决定；body.context伪造点评被排除；原阶段线程pin不变 | composer短请求重复全文、仅报告页显示packet |

如果客户端body.context中的FORGED文本也被有意放进原human消息，必须保留其作为**不可信用户原文**的事实；不得为了通过排除断言而偷偷删改用户消息。CTX-N01特意保证FORGED只在伪造上下文槽，不在human正文。

签核后测试应以实际服务端来源回执所列revision读取相应历史稿建立期望；不能沿用旧helper“每阶段一律当前head”的wire调试假设。当前S6真实原型组已存在旧S5快照与新head，正适合该反例；没有新回执时仍记待实现。

## 无收费执行门与模型预算

- 先运行真实DB/真实controller/usecase至ModelCall边界的用例，记录每个negative的实际调用计数0。观察器不能替造后端成功响应；有意在供应商前拦停的positive只记集成事实。
- atomic accept：记录同一接受事务中的actor/thread/source revisions/pin/snapshot关联；需要屏障时仅绑定本测试org/project/run，不影响其他worker或全局权限。
- 证据中只留测试marker、ID/版本/哈希、状态和计数；不留完整私密prompt、bearer、模型密钥或配置。
- 通过设计签核与无收费反例后再开启计划中的后续真实模型；跨进程账本保留旧两次provider前失败与S1已收费run。普通模型流程每阶段一次、总结一次，不因断言失败自动重发；必须先读取已有持久run/消息。
- `confirm_task_intent`是一次明确的合成学生任务理解选择，不是全局权限。任何脚本、外发、资源新增或不同工具请求另行停下审阅。

## 当前实际状态

| 层级 | 结果 |
| --- | --- |
| 原S1付费运行 | 真实succeeded；同run内部5次模型请求/33647模型tokens/5 settled；学生纠正错误阶段后保存/重登录通过；不证明服务端收到保存context |
| 浏览器wire | 发送时marker断言到达过；原请求未保留raw body，不能事后补造位置。新helper将只存top keys、message roles和布尔marker路径，不存原文/令牌 |
| 服务端来源到实际适配器 | 真实PG→原子受理→ModelCall历史块→Deep适配器实际本机HTTP槽/hash→receipt通过；不是供应商推理 |
| 人类契约签核 | 协调者已通知用户批准桥接；本文不更改签核status |
| 本文CTX用例 | 22项真实PG跨层检查与S2浏览器prepared读取通过；HTTP409全链、浏览器恢复/组装/派发及真实供应商仍待测，不能用PG或prepared代替 |

最终交付须逐项补：实际命令、源码/产物、退出码、call/usage计数、只读receipt来源、证据编号和未解决差异。任何签核等待在人工PDF中保留，不用收费试错代替设计确认。

实际执行、各范围与失败保留见[真实PG执行说明](./bridge-real-pg-verification.md)和[机器证据](./bridge-real-pg-machine.json)。CTX-R02的跨repository持久恢复已测，新浏览器回执恢复尚未测；CTX-R03的PG原型标签是明确合成legacy文字，真实Design两版另有A5旧产物证据，不混作本次生成。新来源lane应按strict selector校验坐标并独立GET真实receipt，替换旧“wire每个marker必须出现”的调试断言。
