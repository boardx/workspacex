# 报告生成终态与保存正文一致性（#5286）

基线 main `6c251df959d0ab498494ed35e9fde4c34c2b8837`。用户 localhost:3000 的代码 SHA `09f220ec772b0e424ef08b30e6d7a9aca22cfa76`；只读确认服务路径，没有修改或重启该服务。

## 根因与边界

report 路由失败 session 只显示错误，未读取最新保存候选；成功 session 又要求当前组件曾观察 running。路由切换、初始化和终态时间顺序因此可以遗漏已保存报告。修复从匹配已授权 revision 的终态接收完整 source；失败自动 GET 对账，保留当前已保存正文，拒绝旧 revision 和低版本回写。重试进度不再取代旧正文。

原始用户生成失败是质量校验 `verifiable_action`：章节编号使合法行动段误拒，独立追踪 #5289。本修复不把质量失败当成功，不降低质量门。私密候选未进入公开证据。

## 验证

- test-first：跨页面快速完成、失败后保存候选两项原代码失败；保留旧正文回归亦先失败。
- 修复目标 UI 14 + stream 3，共 17/17；`/tmp/wsx-5286-final-targeted.txt`。
- web 全套 861 文件：7259 passed，5 skipped；`/tmp/wsx-5286-web-full.txt`。
- web typecheck、受影响 lint（0 warnings）、`git diff --check` 通过。
- `./init.sh` 快速依赖健康检查通过；不称全仓验证。

## 真实浏览器与服务边界

隔离 web15460 / API15470 / DB15475。专属 loopback provider15480返回合成材料；不是外部真实模型质量证据，不传用户报告给模型。

同一合成访谈：初始旧正文v2；失败重试后v3当场显示；从runs生成跳report，质量失败保存v4，report无需手动刷新显示v4；失败正文刷新前后可见文本严格相同。后续有效候选生成v5，错误和重试按钮消失，包含可验证行动及准确逐字来源链接；成功正文刷新前后相同。390×844手机仍显示保存正文。

截图：`failed-with-saved-body.jpg`、`route-failure-body.jpg`、`successful-retry.jpg`、`mobile-saved-report.jpg`。前台统计、审批和重复说明另属#5291，本PR仍保留它们。

不验证导出，不合并或部署；全部按钮审计#5055仍未全部通过。tick因缺COORD_GATEWAY_URL不能访问权威协调面，不伪造租约或开启新自动循环。
