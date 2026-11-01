---
status: confirmed
bundle: personal-order-outcomes-v1
base_bundles: [billing-credits, personal-pricing-v1]
covers: []
confirmed_by: "本会话用户（明确授权回填）"
confirmed_at: "2026-11-01T21:10:18Z"
confirmed_via: "用户回复：采用修订，授权回填并继续；agent 仅记录此次人工决定。"
---

# 个人订单到账结果：缺少支付页绑定的查询修订

依据：已确认个人支付设计 PC8、旧计费数据全部重置，个人支付 issue #6093。独立审查 ecb383b1680ab6f6e67d153ee73e80fcaaf4c5ea 发现：已核实支付可以先于原创建响应落库完成到账；支付商可能不再提供完成后的支付地址。不得把已到账返回503，也不得编造地址或到期时间。

## ① UI
沿用已采用的个人额度/订阅界面与支付弹窗。已确认到账显示成功及真实订单金额/币种，不显示二维码或继续支付链接；缺少地址不影响查询到账结果。人工复核显示需联系支持，不显示支付成功。待支付且无法核实地址仍不可支付。没有新增页面/视觉方向。

## ② 用例
- 归属本人、实际财务receipt+fulfilled已提交，但创建响应丢失/原url与expiry未落库：查询200、SUCCESS；缺失字段null，余额不重复发放。
- 他人或其他generation：404，不泄露金额、结果或地址。
- 待支付/处理中：只有真实非空地址及真实到期时间才返回可支付订单；没有地址不补造信息、不另建支付。
- 到账时间只使用已验证paid_at，未知null；notifyAt未知null，不以恢复查单时间冒充通知时间。
- 本地超时不视为商户关单；人工复核不是成功；旧cancel不能取消新财务订单。
- 原有返回非空地址/期限的订单及已采用UI不变；全量旧数据重置与生产激活仍另行执行。

## ③ API 契约
复用 GET /billing/orders/:orderNo，身份仍由PrincipalGuard决定，输出no-store。

仅将同一权威BillingOrder中的qrCodeUrl和expiredAt改为nullable。增加机械条件：PENDING/PROCESSING必须二者非null；SUCCESS/FAILED/CLOSED可null，表示没有已保存且可验证的支付页事实。同一恢复场景也覆盖POST /billing/checkout的幂等重试响应PersonalCheckoutResult：url与expiresAt同样可空且二者一致；当原购买已fulfilled、closed或需人工复核时，重试返回原purchaseRef，不再新建支付。正常待支付仍须真实非空支付页绑定；客户端取得原purchaseRef后读取GET订单结果，不把null地址或浏览器回跳当付款证明。响应字段和操作路径除此不变，不新增公开写余额/改订单权限。客户端只在待支付且地址非null时展示支付操作；终态只显示结果。OrderDraft继续要求真实非空expiredAt，不能把可空读字段流入新下单。

验证：真实PG支付先到账后原绑定缺失、同一幂等键重试返回原purchaseRef再GET成功，重复读取余额/receipt不变；真实HTTP200/401/404/no-store；契约对待支付null地址的拒绝；现有微信/Stripe收银台终态与类型/lint回归。

## 人工授权记录
用户在本会话对本文件的异步审阅请求明确回复“采用修订，授权回填并继续”。本次据此记录人工签核，可以继续实现上述GET及同key POST恢复与客户端处理；不表示实现、验证、PR集成或生产激活已完成。

## 一致性复核（不代替人工签核）
独立 reviewer 已只读核对该具体修订与原设计一致。采纳补充：PENDING和PROCESSING分别覆盖地址缺失、期限缺失及二者缺失的拒绝；三种终态分别覆盖null；已知字段保留真实值；客户端终态不显示继续支付、不对null期限倒计时。OrderDraft.expiredAt显式保持string。本复核不代替人类签核。

补充恢复一致性约束：终态POST恢复先核对同一payer/SKU/provider/catalogVersion，同键改参仍冲突；关闭新销售后既有购买可恢复且零支付商创建调用。客户端所有恢复响应（包括仍有非空真实地址的终态）都先GET权威状态，不因存在地址再次打开支付页。分别覆盖fulfilled/closed/manualReview三种恢复、原purchaseRef与零新增支付请求，null本身不是成功证明。独立reviewer已只读确认该补充与设计一致，仍不代替人工签核。
