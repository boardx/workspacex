# 显式Docker/BuildKit诊断选择：独立门禁复验

本轮worker仅修改 `tests/test_registry_upload_diagnostics_workflow.py`；其他实现文件由root/Python owner负责。没有dispatch、Docker/network probe、Ready、merge或额外retry。

实际最终复验：`python3 -B -m unittest discover -s tests -p 'test_registry_upload_diagnostics*.py' -v` **27项通过，exit0**，含Python原13项不变语义回归+4项BuildKit场景，以及10项实际YAML/guard测试。日志 `/tmp/aidt-registry-diagnostics-buildkit-final-tests.log`。单独workflow更新版10项也通过，日志 `/tmp/aidt-registry-diagnostics-transport-workflow-tests.log`。自有测试diffcheck退出0。

审查结果：未发现本轮范围内阻断代码问题，可提交新head走正常CI/review；不代表BuildKit真实ACR上传已成功。

- transport选择默认docker、仅docker/buildkit，Python CLI显式选择。默认daemon路径保留；BuildKit模式无daemon docker push，无失败fallback或自动retry。
- 非默认transport独自启用、或unknown transport，实际YAML只允许新diagnostic job可达；实际guard因缺sized/probe/tag而失败，host/shared/normalproducer均不可达。所有newflag组合不会借旧job进入host/prod。
- workflow_call未声明transport时，null/empty按GitHub表达式语义仍保留正常旧路径；显式docker保持原tiny/shared/host分流。两个合法transport只有完整安全组合接受，unknown/空/注入/换行拒绝。
- 原tag五manifest元数据只读；BuildKit写独立`-sized-buildkit`探针tag，32MiB随机payload，`--network=none`、单平台amd64、`--provenance=false`、`--output=type=registry,oci-mediatypes=false`，没有`--load`。
- BuildKit stdout/stderr不原样输出；独立私有metadata文件仅读取严格config/manifest SHA256，再用远端manifest descriptors核对两者，不凭命令exit0宣布成功。
- 仅清理本次probe且image ID精确匹配的local tag/ID，确认不存在，再按**digest** pull并比config/image ID。`pullMayReuseLayerCache=true`限制保留，不声称空daemon重下载。
- 每stage180秒上限与global420秒保留，hosted/manual/source/endpoint防护保留。脚本源码SHA记录GITHUB_SHA；workflow checkout事件exact SHA，不把原release source tag当新诊断控制源码。

实际daemon32MiB probe44006165671为180s未完成；tiny16s成功/五旧manifest missing均为root实际观察。它们证明当前所测路径的结果，不证明底层网络原因，也不代表BuildKit已验证。A/B是新的显式单次诊断，不能改写为重跑daemon成功。

旧PR head1d1e131d的run44005961978已6required真实SUCCESS、checkout c4644057/base27b（3baseline17通过）；新commit会使这份head证据过期，保持PR Draft，等待新head CI/审查，不Ready旧head。

稳定版哈希（供root提交比对）：

- script：`1eba880711f824157af5f425bdc268997e321b2a0c9af4566e980f04bff81a2c`
- script tests：`4734b19527dc24b140dd6b79932aa1609e003d6ccbce7cd428de89217f21e0d7`
- workflow：`777ae73caece7b5a991ddddb0f045c91b46be97158cb29fb4ca27a0b41ee730f`
- workflow tests：`657be551708dcfaba25d939b7de519235a5715849a99f8a6279e437aa5377c0b`
