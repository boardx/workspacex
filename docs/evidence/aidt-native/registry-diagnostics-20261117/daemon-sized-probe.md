# AIDT 32 MiB registry diagnostic：真实失败回执

[Run44006165671](https://github.com/boardx/workspacex/actions/runs/44006165671)，attempt1，head/codeRevision **1d1e131d89996f416b31f0863a570cb82e9817fc**，分支worker/aidt-registry-diagnostic-20261117；created2026-11-17T02:52:47Z，terminal **02:57:11Z failure**。

仅registry-upload-diagnostics执行；build/validate/seal/shared-images/tinyregistry-probe/host-permission-source/host-permissions全部原生skipped。Modeguard和原凭据login均成功。没有应用构建、host部署、SQL、模型或生产操作。

实际JSON artifact **14295100767**、632bytes、name registry-upload-diagnostics-44006165671-1。通过现有GitHub MCP下载原ZIP并本地正常TLS/proxy读取，SHA256 **10940507563f6438bd137feff1b4fc2c33bb79ed5cba475da31ccaa7ba49a46d** 与GitHub元数据、上传job日志三方一致。原始JSON副本：[receipt](/tmp/aidt-sized-probe-44006165671-receipt.json)。没有保留签名下载URL或credential内容。

实际结果：

- DockerServerVersion=28.0.4；payloadBytes=**33,554,432**，为32MiB随机payload的FROMscratch镜像。
- 已生成imageIdBefore=sha256:c9632f2e471a58bc81cd1a6663ec35c55c96996bedb04c445e187dcf0c403cdf。
- 只写探针tag **acr-probe-44006165671-1-sized**；原失败tag44000938132-90000000000000000001仅manifest metadata读取。
- 原tag的api/web/agent/sandbox/postgres **全部status=missing，descriptors=[]**，没有可用原tagmanifest。该结果来自实际认证后的诊断，不是由上一轮artifact缺失猜测。
- push只有一个layerId=b7591433c554；02:54:07.4920598Z记录Preparing、elapsed0.924秒；没有Pushed完成记录。02:57:06.5720770Z明确 **PUSH_TIMEOUT**，由原定180秒预算触发。
- JSON push.elapsed=0.924表示**最后一条允许输出的层进度时间**，不是push总耗时；completedCount=0、layerCount=1。
- 未到删除本地镜像/验证不存在/pull步骤；localTagAndIdAbsentBeforePull=false与没有imageIdAfter不能称“pull失败”。pullMayReuseLayerCache=true是脚本声明，不表示pull发生。

结合根线程先前核实的tinyprobe44003858952（push16s/pull5s成功），当前证明了**小标记上传可用，但32MiB随机单层不能在180秒预算完成**。这比五服务push720秒超时更具体，仍不能证明底层是带宽、MTU、redirect、registry限制、压缩或daemon。日志没有HTTP状态/redirect证据。新随机单层也失败，说明不能把问题仅归到之前的某一个共享baseblob身份。

既有旧tagmanifest全部缺失，不能绕过完整镜像组/身份/schema门禁尝试应用部署。后续应由root依据这份回执选择有区分力的上传路径/daemon层诊断；本子任务不增加timeout、不重跑、不变更代理/TLS/权限、不取消远端任务。到本报告已停止本地poll；没有自动发起下一次探针。
