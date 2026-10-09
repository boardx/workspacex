# 候选五镜像 v2（未执行）

这是独立候选构建协议，不修改 schema 1 或正式 exporter。固定 source 为
`55d904af3edcca54b2fbe17bba59ed2eed09323b`，control 必须使用本代码审查、合入后的真实完整 SHA；目前尚无新 control SHA。不得填 PR SHA、移动 ref 或旧 control 代替。

## Stage 1

`scripts/cn_image_candidate.py` 的 `validate_plan` 是输入单源。输入 kind 为
`cn-image-candidate-v2`、schemaVersion=2，仅接受 Node/Python/pgvector 三个 public
registry digest；sourceContracts 精确绑定五服务的 repository、Dockerfile、context、
bases 和原始 Dockerfile SHA256。source SHA 绑定其余 context 内容。身份包含协议、source、control、platform、三个 bases 和 contracts，不含 attempt 或预算。

候选使用 `org.workspacex.candidate-build-identity`，拒绝旧
`org.workspacex.archive-build-identity`。Docker-save 只保留一个镜像的 config、layers、manifest，流式验证 config hash、layer diff IDs、platform、source 和 identity。每服务上限2GiB、全套10GiB、余量2GiB；service实际空闲至少10GiB，collector下载前至少12GiB，下载后同filesystem只rename而不复制tar，剩余至少2GiB、4096空闲inode。没有自动清盘或预算放宽。

```bash
python3 -I -B scripts/build-cn-image-candidates.py --plan PLAN --plan-sha256 RAW_SHA --check
python3 -I -B scripts/build-cn-image-candidates.py --plan PLAN --plan-sha256 RAW_SHA --source EXACT_SOURCE_CHECKOUT --service api --output FRESH_OUTPUT
python3 -I -B scripts/build-cn-image-candidates.py --plan PLAN --plan-sha256 RAW_SHA --collect FIVE_FRAGMENT_DIRECTORIES --output FRESH_FLAT_BUNDLE
```

独立 workflow `.github/workflows/build-cn-image-candidates.yml` 只有 manual main 入口，contents:read，无云凭据、Redis拉取、registry push、OSS上传。再次检查event/ref后执行；5 parallel标准Ubuntu24.04 jobs。所有artifact留1天，收据有效最多1小时；collector保留最早expiry，不刷新。collector只上传metadata；tar只在各serviceartifact中保存一次，flat bundle通过move形成且验证失败尝试恢复。releaseReady/productionReady永远false。

这轮只开发/测试，没有push、dispatch、真实Docker构建或付费资源。预算US$1仅可能覆盖单次candidate build的已确认存储范围，不是此workflow的技术硬限，不含重试、Stage2或生产权限。

## Stage 2 离线验证（未实现可信发布）

```bash
python3 -I -B scripts/build-cn-image-candidates.py --plan PLAN --plan-sha256 RAW_SHA --assembly ASSEMBLY_INPUT --assembly-sha256 ASSEMBLY_RAW_SHA --candidate FLAT_BUNDLE/candidate-set.json --candidate-sha256 CANDIDATE_RAW_SHA
```

assembly输入kind=cn-image-candidate-assembly-v2、schemaVersion=2，包含candidateRawSha256、candidateIdentity、redisImage、release。命令验证collection原文hash、五tar原文/config/layers/labels、TTL、原始planhash和assembly绑定。redisImage仅是语法合规参考，不是authenticated receipt；未知字段如authenticatedRedis=true会拒绝。输出NOT_READY、exit2，列明可信Redis路由和版本化publish消费者尚未实现。

后续真正assembly必须新增已审消费者，保持candidate tar不变，以独立assembly receipt绑定晚到的Redis认证及release。不得补旧label冒充schema1归档。原Node manifest generator/validator/sealer、registry immutable readback、backup/recovery、prepare/promotion/activation、业务验收均不可省略；旧消费者仍拒绝候选。

验证：`python3 -I -B tests/test_cn_image_candidate.py`；`actionlint .github/workflows/build-cn-image-candidates.yml`。
