# 中美定价 UI 原型 · 待人工确认

Issue: #6086。仅 mock，无真实支付、数据持久化或后端 API 变更。旧束的 confirmed 状态不覆盖本次增量。

## 运行与查看

在本 session 唯一 worktree 运行：`NEXT_DIST_DIR=.next-pricing-ui pnpm --filter web exec next dev -p 3526`，访问 `/preview/pricing`。

页面上方可切换中国／美国／DevApp、个人／团队／管理员、七种状态。账户右上可切换月／年样例、Free 或团队到期样例。

## 视觉方向

沿用现有 background、card、foreground、muted、border、primary 六个语义 token，不新增品牌色或字体。字体沿用 Noto Sans SC；字号与圆角只使用既有档位。

```text
额度与订阅                         周期／状态样例
[充值余额                    ]  [套餐状态、订阅余额、百分比]
[购买额度 / 查看用量         ]  [额度到期 / 订阅到期       ]
[三个充值包的简短价格列表    ]  [查看套餐 / 续费管理       ]
                                [订阅历史                 ]
```

移动端按充值、订阅顺序纵向排列。购买弹窗区分套餐、额度包和增员；增员继承团队既有周期，不允许在补差价时切换付款周期。

## 人工确认清单

- [ ] 双栏余额／订阅布局、金额、信息密度与移动端弹窗。
- [ ] Pro／Team 月年付选择、Free 赠送提示、微信手动续费与 Stripe 自动续费文案。
- [ ] Team 已用 4／已购 5 席的显示、增员报价与共同到期日、到期后的使用限制。
- [ ] 平台管理员 Team 列表、Enterprise 升级二次确认、手动加额度与原因输入。
- [ ] 默认／加载／空／校验失败／依赖失败／无权限／成功七态。

## 明确边界

报价采用固定剩余 50% 的演示数据；增员首期额度折算、Free 赠送到期策略仍待业务裁决。模拟支付不会改变真实账户，模拟管理员修改刷新即消失。权限状态是预览，不是后端授权证据。

现有生产组件不被替换；正式实现应复用本次内容组件并接入真实契约，不把本 fixture 当作服务端价格目录。此阶段无新契约束划分；确认后将相应材料纳入最终束级 ui.md。

## 截图索引

- [account-1280](account-1280.png)
- [account-375](account-375.png)
- [account-768](account-768.png)
- [credit-packages](credit-packages.png)
- [enterprise-grant](enterprise-grant.png)
- [enterprise-list](enterprise-list.png)
- [enterprise-upgrade](enterprise-upgrade.png)
- [free](free.png)
- [plans-1280](plans-1280.png)
- [plans-375](plans-375.png)
- [plans-768](plans-768.png)
- [state-empty](state-empty.png)
- [state-err-pricing-denied](state-err-pricing-denied.png)
- [state-err-pricing-depfail](state-err-pricing-depfail.png)
- [state-err-pricing-invalid](state-err-pricing-invalid.png)
- [state-loading](state-loading.png)
- [state-pricing-saved](state-pricing-saved.png)
- [state-pricing-wallet](state-pricing-wallet.png)
- [team-add-seats](team-add-seats.png)
- [team-expired](team-expired.png)
- [team](team.png)
- [us-annual](us-annual.png)
