# A6独立只读交叉审阅

2026-11-16；未修改其他worker的业务文件。以下是源码审阅与验收建议，不是实际Design/模型请求通过证据。

## A2：历史反思进入原生Chat

审阅提交 `5fd28e0108e33b2b653aa343cea59813e56ed245` 的 `aidt-chat-return-context.ts`、`project-aidt-chat.tsx`及其测试。

- 仅使用明确选定的历史GET，`beforeRevision=revision+1, limit=1`；校验项目、阶段6、精确revision、学生确认及返回目标，不回退head。
- 仅投射原问题、前后理解、原因/行动及必要引用；报告/任意字段不进上下文；总量/字段限额、Unicode及untrusted材料标签保留。
- host将同一对象传入TeachingContext及纯文字预览；生命周期隔离含身份、项目、步骤和revision，迟到结果有丢弃检查。
- 必须由root给Chat传入`returnRevision`。A6新增实际浏览器反例：在可见Chat重载后真实读取历史，展开可见pre核对精确旧原因。漏线或读head会失败；错误引用时继续使用原生composer但不发模型请求。
- 该native检查能证明真实API回读与host投射；模型实际消费该上下文、质量及超时表现仍需真实模型lane。

## A5：真实Design版本选择

审阅新增helper/picker及既有Design API `prototype-versions.ts`、`list-my-projects.ts`、契约的实际形状。

- 已关联资源与当前owner列表取交集；关联本身不授权。选择时再核关联、owner及单版本GET，未看到跨owner放行路径。
- 既有API确会额外给summary/version带`links`；A5对该已知字段做canonical node schema扩展，其余字段strict，不是静默容忍任意extra。
- 单版本必须id匹配、frame/prototype长度一致且至少有一份实际tree；不会给全null规划记录制造“生成完成”。部分生成用实际页数呈现，质量不据此确认。
- helper是只读，callback交由host保存实际designId/versionId；不会直接改写第6步snapshot。root仍须验证host改选B后已保存S6的Q_A不变，直到学生明确重新带入。
- A2已独立指出“移除引用时pending选择迟到回填”竞态并交A5修正；A6不重复修改。须在最终提交核对其取消/忽略迟到回调回归。
- 受控API/jsdom测试不是实际生成版本或真实模型验收。没有已保存Design版本时必须保留手工引用和未验证边界。

## A3 / A4兼容与建议

两位owner确认原report/global-member-chat接口、按钮和testid保持兼容。A6保留report页发送成员文字的原入口。初次只核对pageSize5而担心较早V1不在首个5项范围内；与A3进一步核对后已纠正：collector会按实际nextBeforeRevision读取第二页，每阶段最多10份，本例7份S6均应读到。第二提交已补实际两页响应、章节审阅/追加/主动保存及新登录textarea恢复断言，待root完整native执行，组件测试不能替代其结果。
