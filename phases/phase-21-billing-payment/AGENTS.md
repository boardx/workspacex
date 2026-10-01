# AGENTS.md — Phase 21 (billing-payment) 局部指令

> 阶段级 scoped 指令,补充根 AGENTS.md。只写本阶段特有的约束。

## 本阶段焦点
参考 boardx-backend 与 boardx-web 的既有支付实现，交付 WorkSpaceX 的支付/计费能力：微信 Native 扫码与 Stripe 订阅的完整闭环（下单→扫码/跳转→回调→到账→查询），含前端收银台与必要的管理端

## 权威来源
- 功能清单:本目录 `feature_list.json`(本阶段唯一权威)。
- 进度:本目录 `progress.md`。

## 规则继承
根 `AGENTS.md` 的所有硬约束在此继续生效(尤其"完成定义"与"干净收尾")。
