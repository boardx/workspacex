# Node22.23.2 完整命令的实际边界

源码：66c0673887e203ee5dd056c47a6ce5234ade0eb4，仍为旧stack（P5原父b4dd），尚未重基到P4实际合入版本。

命令：`env PATH=/Users/shenyangjun/.nvm/versions/node/v22.23.2/bin:$PATH ./init.sh --full`。

- 全部静态门禁通过。
- harness：249文件，2816通过、4跳过；原native ESM加载文件16项全部通过。
- 全仓typecheck/lint通过；contracts1254、local-runtime250等包通过。
- Web：966文件，8438通过、5跳过。
- API已输出完成82个文件，尚无全量汇总。仓库API配置固定1worker；剩余完整API由最终PR的标准独立数据库分片及队列验证继续执行，不缩小该CI范围。

此命令由执行方主动SIGINT中止，`init.sh`最终exit1，**不是完整full PASS**。停止前没有报告真实测试断言失败；init最后的“完整验证失败”包含本次主动中止，原始输出保留`node22-full-partial-output.txt.gz`，没有删失败或改写输出。此前3次真实失败另存。

中止信号后隔离器未自动完成清理，已对本次明确project `wsx-64681d02d21b9ca03b25`手动`docker compose down -v`退出0；仅在wrapper43114及其后代均已退出、端口探针可绑定后清除该owner的1个stack lease及13个port markers。其他owner未碰。cleanup实录附后；当前无本任务Next/Chromium/compiler/compose，不能把此次标为自动清理成功。
