# AIDT BuildKit 32 MiB上传对照：成功回执

[Run44008536612](https://github.com/boardx/workspacex/actions/runs/44008536612)，attempt1，created2026-11-17T03:12:30Z，terminal **03:14:18Z SUCCESS**；workflow head与JSON diagnosticCodeRevision精确一致：**4ea17e141feab4527df2f82f272d5ad4add3753e**。

仅registry-upload-diagnostics执行；host-permission-source、host-permissions、generic build/validate/seal、tiny registry-probe、shared-images均actualskipped。与另一个host-readiness run分开，本报告不代替该run的验证。

实际artifact id **14296085469**，845bytes，name registry-upload-diagnostics-44008536612-1。经GitHub MCP下载原ZIP，SHA256 **afd4d79768e042e1f73a14d2cb9bc48b1fb3c472da285c32345e84b91e39e96e** 与GitHub API metadata及job上传日志精确匹配；正常TLS/proxy读取原件。JSON副本：[receipt](/tmp/aidt-buildkit-probe-44008536612-receipt.json)。没有保存签名URL或凭据。

实际控制条件与结果：

- transport=buildkit，DockerServerVersion=28.0.4，32MiB随机payload=**33,554,432bytes**。
- 独立probeTag **acr-probe-44008536612-1-sized-buildkit**，不触碰应用tag。
- 明确registry exporter、linux/amd64、network=none、provenance=false；无普通daemon docker push/fallback。
- build/export/push整体实测 **26.695秒 completed**：03:13:36.8819609Z started，03:14:03.5774047Z completed。
- BuildKit metadata给定expectedManifestDigest，远端manifest/config descriptors匹配后再按digest pull。
- localTagAndIdAbsentBeforePull=true；imageIdBefore==imageIdAfter==**sha256:d7f5fd0d190f8231551bd06d7da3dfd1fb4ccb13d2ef99ff3ad0a74422778440**。
- manifest **sha256:4a7ef4d4844eb5b1aa669b3f020a53a8c6746bf6433df0ed034dc08c2010c68e**，528bytes；config438bytes；layer **sha256:4156cfb7589ad5664c123e4e6f39345bbc78d6d8534477f5aaab59135a619aad**，**33,564,845bytes**。
- Pull按digest成功并核ID相等；最后层进度Already exists/elapsed3.439。pullMayReuseLayerCache=true，所以这是digest/config/image-ID读回验证，**不证明一次独立全量32MiB下载测速**。
- 原失败应用tag44000938132-90000000000000000001在五repo中仍全部missing、descriptors=[]。

结合上一轮同大小普通daemon push的180秒PUSH_TIMEOUT与tiny push成功，这个新对照支持优先调查/修复**上传实现路径差异**；它反证“所有32MiB上传都无法到达”的宽泛说法。它不能单独证明Docker daemon具体bug、MTU、代理、压缩策略或HTTP redirect根因，也不证明五个真实应用镜像可完成上传。

可据此准备受审阅的最小BuildKit registry-exporter应用构建方案，保留default行为、source/tag/flavor/digest门禁和完整同attempt五镜像组，并在实际app产物验证后才进入既有host/schema发布流程。不能直接拿scratch probe镜像部署，也不能把probe成功写成DevApp已发布。

本子任务仅只读监控和取证。未重试、取消、再次dispatch、修改代码/配置、触发应用部署/SQL或读取secret值；本地poll已结束。
