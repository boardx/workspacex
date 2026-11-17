# 真实镜像producer BuildKit registry export：独立审查与验证

2026-11-17，工作目录`/workspace/aidt-pr-20261117`。本worker未修改仓库文件；仅创建临时独立测试harness与报告。没有Docker/registry/model请求、workflow_dispatch、Ready或merge。

## 结论

最终稳定实现未发现本次范围内的阻断问题，可由root提交新head并走正常CI/审查/原生队列。不能复用旧4ea失败CI或旧1d成功CI当新head验收。

实际producer从`buildx --load`之后daemon push改为**单次BuildKit registry exporter**；保留原Dockerfile/context、linux/amd64、source/release-tag labels、base image pin、package sources、Web公开开关以及immutable run/attempt/AIDT tag约束。显式DockerV2 media/provenance关闭，无`--load`、daemon push、fallback或upload retry；单次build+export仍用原2400秒cap，没有采用#6684预算提案。

独立审查确认：

- 导出metadata在私有0700临时目录，创建文件0600；读取限制2MiB，仅接受dict与两个格式严格的SHA256字段。完整metadata/provenance不进入公开产物。
- 只有export成功+metadata有效后才进行现有实际Docker pull/inspect readback。`expected_source=source`用于本次fresh producer强制exact source及releaseTag（缺失也拒绝），旧非producer alias兼容默认路径保持不变。
- write result前再次逐项比较请求source、config digest=image ID、repository+manifest digest。producer不会把“格式正确但source不同”的镜像写成成功，也不只依赖aggregate事后阻断。
- missing/empty/oversize/symlink/invalid metadata阻止readback/result；source/config/manifest/platform/label不符阻止result；timeout/denial/readback失败不触发第二次export或daemon push。
- exporter错误可能含供应商签名URL，现有safe_diagnostics先移除所有HTTP(S) URL query与auth/env secret，再截断；本地签名query反例通过。
- 仍使用原同attempt全五服务manifest聚合规则；没有把部分push结果写作完整release。

## 实际执行证据

1. 仓库现有与新增registry相关测试：

```sh
source /tmp/aidt-pr-env.sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_registry*.py' -v
```

**66项全部通过，5.400s，进程退出0**。日志`/tmp/aidt-real-producer-registry-tests.log`。这是本worker新执行，不借用owner先前5.146s结果。

2. 独立临时harness：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B /tmp/aidt-registry-export-independent-tests.py
```

**3个测试方法全部通过，16个独立失败场景，0.045s，进程退出0**。日志`/tmp/aidt-real-producer-independent-tests.log`。直接导入真实producer函数，不复制其判断逻辑：

- 9种metadata故障：不存在、空、symlink、合法JSON但超过上限、坏JSON、数组、缺config、错config digest、manifest尾换行。
- 3种export后格式合法但remote不一致：source/config/manifest，验证**不创建result文件**；并实际验证private文件/目录mode及仅一次2400秒registry exporter。
- 4种实际resolve拒绝：非Linux、非amd64、releaseTag错、digest namespace错。

没有把69个方法执行次数称作69个不重叠业务能力；其中独立harness故障与repo回归有有意交叉。

## 稳定源码身份

执行前后哈希与owner冻结值一致：

- `scripts/registry-images.py`：`6482a264ae954ffd4df0f94bc291f4e52c3287295ed3d805a4053f962985b545`
- `tests/test_registry_aidt_opt_in.py`：`87be01d079126ea744f4446658b4d02185eccef6c56d5c4cdc18df032b1ca8d5`
- `tests/test_registry_buildkit_export.py`：`1c3cb36fc4a3bc3bc37f533da21568b0cdb25cb6e651db86d09583be03d1974e`

## 边界与下一步

真实32MiB BuildKit probe的26.695s成功对比daemon180s失败，为本次替换上传实现提供受控证据；这不是底层网络根因已证实，也不是五个真实应用镜像已构建/上传/部署。这里的66+3测试使用command-boundary/local fixture，不声称真实ACR发布通过。下一步由root冻结新commit、确认同head CI六项/实际checkout源、review及队列candidate；后续真实release按新不可变run/attempt生成完整五服务证据，不改写旧失败。
