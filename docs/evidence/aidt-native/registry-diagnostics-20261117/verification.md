# Registry upload diagnostic：独立工作流审查与本地验证

工作树`/workspace/aidt-pr-20261117`，分支`worker/aidt-registry-diagnostic-20261117`，base27b305e。没有触发workflow、执行Docker/registry请求、改hostpolicy或修改`registry-images.py`。

本worker唯一新增仓库文件：`tests/test_registry_upload_diagnostics_workflow.py`。Python脚本/其测试由Python owner修改；workflow由root修改；现存两份upload-diagnosis证据未覆盖。

## 审查结论

当前稳定版未发现阻断本次手动诊断的代码问题，**可进入正常PR/队列验证**。这是本地/源码审查，不是ACR真实32MiB probe成功、五镜像push完成或DevApp已发布的证明。

- 默认`sized=false/existing_tag=''`保留原tiny、shared、host以及正常producer路径。
- 实际YAML的`workflow_call`不含新inputs；缺失/null按GitHub表达式coercion仍进入旧validate/build/seal，不静默全部跳过。
- 任一newcontrol启用时，所有旧host/shared/tiny/validate入口都拒绝；新job在ubuntu-hosted运行，没有production environment、sudo或host入口。
- 新job实际Python guard在auth之前执行；只有`sized=true/probe_only=true/shared=false/hostoff/严格原tag`组合放行。非法组合会失败，不会落入旧producer或host路径。
- 新jobcheckout实际github.sha（未改ref即Actions默认事件SHA），persist-credentials=false。脚本再校验GITHUB_ACTIONS/managed hosted/manual event、禁止Docker endpoint/TLS overrides，并将GITHUB_SHA写为diagnosticCodeRevision。
- 秘密只绑定login step；diagnostic脚本不继承该step专属secret env。progress只固定stage/layer/status/elapsed；manifest只descriptor kind/digest/size；不打印raw stderr、Ref、URL、annotations、token或凭据。
- 只向独立api `acr-probe-run-attempt-sized`写32MiB `os.urandom`合成scratch image；五原tag只读inspect metadata，missing与auth/transport/TLS混合错误不混为不存在。
- push/pull每段最多180s，无push自动重试；probe tag必须事先确认不存在。删除本地tag后检查tag和imageID都不存在，再pull并比imageID。报告明确`pullMayReuseLayerCache=true`，因此是删除引用后重新pull，不宣称空daemon或全部blob重新下载。
- artifact只上传固定JSON，always清理专用DOCKER_CONFIG；不prune全局Docker，不删旧tag/blob，不改预算PR #6684相关`registry-images.py`。

## 找到并已修复的反例

初版所有stage deadline加总超过10m job预算，可能CI先硬杀而来不及写receipt。已向root/owner报告；最终版增加独立420s整体deadline，所有command夹到剩余时间，超时产生安全partial receipt。Python owner加入虚拟慢metadata反例（push实际只获剩余158s→DIAGNOSTIC_DEADLINE），本worker重新执行通过。该调整仅诊断脚本，不改正式镜像上传预算。

## 实际测试

| 测试 | 实际结果 | 日志 |
|---|---|---|
| 新workflow，真实YAML+表达式真值表+实际validator Python代码 | 9通过 | `/tmp/aidt-registry-diagnostics-workflow-tests.log` |
| 最终新diagnostic脚本测试 | 13通过 | 与workflow合跑最终日志，见下一行 |
| 最终`test_registry_upload_diagnostics*.py`（2文件） | **22通过，exit0** | `/tmp/aidt-registry-diagnostics-final-tests.log` |
| 既有registry_images | 20通过，exit0 | `/tmp/aidt-registry-diagnostics-images-regression.log` |
| 既有registry_pull_retry | 4通过，exit0 | `/tmp/aidt-registry-diagnostics-retry-regression.log` |
| 既有registry_aidt_opt_in | 10通过，exit0 | `/tmp/aidt-registry-diagnostics-aidt-regression.log` |

本轮最终对应56项本地测试成功（22最终新测试+34既有回归）。旧9项脚本初版结果只作过程证据，未当最终13项重复累计。最后deadline/managed-env等修改仅脚本+其测试；workflow和registry-images不变，故未重复34项无关回归。我的测试文件`git diff --check`exit0。

独立workflow测试用仓库vendored YAML parser读取实际文件，不依赖PyYAML；实际job predicates由窄GitHub表达式解释器求值，未知语法拒绝；不仅匹配if字符串。覆盖默认、workflow_call absent/null、legacy tiny/shared/host、sized/tag/probe/shared/host组合、非manual事件、实际validator拒绝tag注入/尾换行，以及auth前排序、alwayscleanup、host/prod隔离、固定payload/artifact。

复现最终新测试：

```sh
source /tmp/aidt-pr-env.sh
python3 -B -m unittest discover -s tests -p 'test_registry_upload_diagnostics*.py' -v
```

本地单元fixture不代表真实Docker CLI manifest verbose形状、registry权限/吞吐或网络层结论；下一步仍需正常PR+source-bound队列六项，再由root单独手动诊断并读取实际JSON。

## 稳定版SHA256（提交前请核字节）

- scripts/registry-upload-diagnostics.py：`4c48a88d44bf0265ba9610134fecf5a03dc666c7e4d0795407b620fbf1d39541`
- tests/test_registry_upload_diagnostics.py：`518254cca0847c5978a48c9212f3a25de4e8739ec7c94f6c33673a5dda51dfab`
- .github/workflows/build-cn-release-artifacts.yml：`1038cc00eb08521be6d918cc0b3f2e34bc6c024f7ac178fb15d81c80896b5f60`
- tests/test_registry_upload_diagnostics_workflow.py：`3a39ccb2b53391faed4660c44e1e64f3ead95e3d8ede61708e9cb82d9bfa56bc`
