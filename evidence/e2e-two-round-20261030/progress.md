# 后台两轮 E2E
被测main：d149a333b82604a2b2bcc68b5dd19bba81e7810e。
两轮独立隔离栈，headless Chromium，单worker，确定性模型。业务批次清单256条；其余沿用核心/设计/聊天/资料完整配置。
状态以current.json、runs.json、各批次results.json为准。启动构建期间不算用例通过。
协调tick缺COORD_GATEWAY_URL，未注册身份。init快速检查通过。

## 2026-10-30 测试完成
两轮基线517/9/8、522/4/8；最终526/0/8。已修复并建立四个独立PR，见report.md。保留全部失败与资源中断，37 API+298 core+32 Web单测通过。17栈释放；源码与生成配置恢复，CI动态状态用pr-queue查。无feature passing修改、无合并部署。
