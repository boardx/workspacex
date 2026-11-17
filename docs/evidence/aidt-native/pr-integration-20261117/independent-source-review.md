# AIDT 最终9路径独立源码复核

结论：在已明确的源码CI发布入口范围内，未发现剩余P1/P2阻塞。初版“启用镜像tag以enable=false复用至生产”P2已通过reserved numeric attempt namespace及plan/build一致性门修复。

## 审阅身份及版本

- 此为独立子代理源码与定向测试复核，不是GitHub正式人工批准，不执行merge或部署。
- 复核基点：`1a2ec212d`；契约/登记修复已提交为`bb787154a`，最新记录commit为`14383a6ce`；发布4路径在本轮测试时仍待最终提交，以下SHA256固定审阅字节。最终commit需确认与其一致。

## 核查结果

- `.github/workflows/image-release.yml`：手动触发要求保留，输入默认false；AIDT release变量覆盖全service matrix，两个公开Web flag只给Web服务，API runtime flag/权限/策略/schema门均未修改。
- `deploy/aliyun/images/web.Dockerfile`：两个flag仅builder默认0并在Next build前设置；runtime stage没有新增继承环境字段。没有实际构建Docker镜像或声称镜像已验收。
- `scripts/registry-images.py`：仅新启用发布生成`run-9000000000000000000<attempt>`；符合旧short/legacy tag正则。保留真实attempt以reserved prefix开头时拒绝，避免普通attempt碰撞。生产目标对short与legacy形态marker都拒绝，无论enable=false/true与build_only。producer要求全release开关、Web两flag、目标DevApp、tag flavor及真实run/attempt完全匹配；所有服务共享同一tag。
- `tests/test_registry_aidt_opt_in.py`：包含真实CLI planning与生成命令验证（Docker/registry subprocess受控模拟），默认off、新标记生成、CN/US复用拒绝、碰撞、矩阵一致性和shortalias反例。
- `packages/contracts/src/aidt-stages.ts`及`shared-stage-unit.test.ts`：所有阶段修订/来源/报告来源/历史游标上限为PostgreSQL integer最大值；save基修订最大减1，允许最后一次合法append，并在溢出前不触及存储。现有初始revision0与source必须positive语义保持。
- `packages/contracts/src/project-member-chat.ts`：只将schema导出重名改为MemberChatReadOnlyReason；现有Access使用改后符号，无运行授权语义变更，未发现引用旧符号的消费者。
- `packages/contracts/src/skill-entry-points.ts`及对应测试：7个AIDT稳定名称唯一登记为隐藏的模块宿主展示能力，不进入普通三入口；未改技能加载、挂载、已存pin或权限。

## 独立验证

- `python3 -B -m unittest discover -s tests -p test_registry*.py`：34/34通过；其中Docker构建/推送日志来自受控命令替身，没有真实registry I/O。
- contracts现有本地Vitest：skill-entry-points 7/7通过。
- API现有本地Vitest：shared-stage unit47+controller10，共57/57通过。
- 独立namespace矩阵额外72条CN/US拒绝断言通过，包含short/legacy、flag两值与多run/attempt；普通tag通过、reserved attempt碰撞拒绝。
- `git diff --check`通过。初次pnpm包装器因工具版本尝试外目录store而失败，随后直接使用已安装node_modules/.bin/vitest完成上述TS验证；未安装依赖或修改仓库。

## 明确未覆盖边界

- Numericnamespace是源码CI入口约束，不是镜像内容的签名/密码学证明。没有为新旧镜像创建虚假flag attestation。
- 当前正式消费者/服务器wrapper未改，无法声称能阻止直接host调用或外部manual retag。特别是旧`sourceSHA-run-attempt`别名在resolve的LEGACY_TAG分支只校验source前缀，不检查release-tag label；本轮shortalias拒绝测试不能泛化为所有alias防护。该边界已向root明确，root限定本轮不扩host/auth/policy/schema范围。
- 不等于GitHub CI、正式人工review、真实Docker构建、DevApp功能验收或生产发布完成。生产未授权，本代理没有执行这些动作。

## 审阅字节SHA256

- `.github/workflows/image-release.yml`: `8d4d8f7e4c72ce85b55f52ce8e6889e77b8baa597325ec9afab5f82a664f67fd`
- `apps/api/tests/aidt-stages/shared-stage-unit.test.ts`: `9bad14162b7eee2ae1677c1f4a8a5d8574a9370de788617f0b12dcb8ff4e9790`
- `deploy/aliyun/images/web.Dockerfile`: `6de73a39dc42019b900a482a76650d38813c5ca2dffbeb1c98851adae839c691`
- `packages/contracts/src/aidt-stages.ts`: `0658791ee7128e7409a22a4aa5f9ed53b2e775a13840a87ee1c7a7f31f43e6ec`
- `packages/contracts/src/project-member-chat.ts`: `56595e40612f4bd2bd12a5fc7c5013d60c7ea2c37bae416d12ecb8bbf2357e10`
- `packages/contracts/src/skill-entry-points.ts`: `d64c6d94140a7b23ab22c675f56bfe54aca865e72b373f1576b7aa425dbb467f`
- `packages/contracts/tests/skill-entry-points.test.ts`: `31b1d9ef4315ffd43c9b1d4b43a4d779e2d3be2b9009f2fd25787346ca42122d`
- `scripts/registry-images.py`: `0531780cc83825bed177e60acebb38a88228c792f3bd5d613f69722e09e89c58`
- `tests/test_registry_aidt_opt_in.py`: `c4af02e8662390679fbf3cf0a40826c9160eabd3ee289c83888c8ccf1082bda3`
