# references —— 回复起草（S015）

本目录不复制实体文档正文（单一事实源：`requirements/work-stack-v2/skills/S015-response-drafting.md`）。`commitment-lexicon.json` 是规格 I4 点名的承诺词表，**单一事实源**；评测 grader 读取同一份文件，不另抄。

## 规格静默处的实现取舍（评审请确认）

- manifest 依赖：规格「required：ticket.read 或 mail.read（按 inbound.ref.kind）」无法在 `required`/`optional` 两个列表里表达「二选一」，实现为 required=[knowledge.read]、optional=[mail.read, ticket.read]，接线时由运行时按入站类型强制。
- 承诺词表条目由实现者按规格 I4 的样例词（将于/保证/我们会退/免费补偿；will/guarantee/refund/by \<date\>）初拟并补充，内容待评审；词表与 I4 判定只影响「命中则必须登记 commitments」。
- E2/E3 的服务端核验结果（approvedBy 是否核验通过）体现在断言 spec 的 `facts` 里（E3 为降级后的 kind=fact），而非模型输出里。
- E4 的 8 词重叠按 token 判（CJK 按字、拉丁按词）；E6 的 recipientAudience 取 internal（审阅意见对象是同事）。
- E10/E11/E14 输出为 `{ ok:false, error }` 错误包络；E14 的「人为构造的坏输出」放在夹具 e14-broken-draft.json（缺 A2 的 coverage），样本为校验器应返回的错误。
- 规格 §13 未指定必过集合；`mustPassCaseIds = E1/E3/E4/E5` 取自「F1–F4 违例数」四条主指标与「真实模型 lane 至少覆盖 E1、E4、E5」，待评审确认。
- 规格没有专门的授权拒绝用例，E10（签名越权）标 permission-denial。
