# AIDT 待推送范围公开性只读审查

- Worktree: `/workspace/aidt-pr-20261117`。
- 审查 HEAD: `1a2ec212d38635a60b1337cc4a949ec564c0d7a8`。
- 基线 origin/develop: `4060bcf2017ef5775b762f2135f22042f8a96d19`。
- `git rev-list --count origin/develop..HEAD` 为94：93个非merge feature提交+1个集成merge。审查开始时工作树干净。

## 结论

本次检查未发现阻止将此范围提交PR的敏感命名运行时文件、数据库转储或可见敏感二进制内容。24份二进制逐一视觉检查，均为合成教学素材、合成验收导出或原型/版本关系截图；没有登录/密码页、真人照片、受访者身份或真实访谈录音。此结论限于下述实际检查，不替代root另行进行的provider key全历史blob扫描，不宣称全库秘密检测已完成。

## 历史文件名与运行时核查

- 使用 `git log --diff-filter=A --name-only -z origin/develop..HEAD` 检查所有新增路径：1720个唯一新增路径，全部仍存在于最终树，没有“历史加入后删除”而避开当前树检查的新增路径。
- 敏感命名模式覆盖 .env、secret/credential/password/private/checkpoint/dump/backup/session/cookie/token/runtime/trace，以及.dump/.bak/.db/.sqlite/.zip/.gz/.tar/.har/.pem/.key/.p12/.pfx。没有实际.env、密钥、cookie/session持久文件、DB转储/SQLite、压缩运行时包、HAR/trace进入新增路径。
- private/checkpoint/backup名称命中的是应用源码、测试、操作计划或只读JSON回执；回执包含私有路径、dump hash/字节数、行数、测试run/request/group ID、账务计数。没有私有dump字节或uploadedModelConfig拷贝。文件名中的private不等于该文件本身是私有备份。
- 对所有1720新增文件检查魔数：仅12PNG+12PDF；没有PGDMP、SQLite、gzip、ZIP或其他含NUL二进制。全提交历史numstat也只有这24个binary路径。
- 全部7个SQL文件是5份AIDT迁移、1份迁移审阅、1份migration-replay probe；没有PostgreSQL dump header或COPY FROM stdin转储。
- 没有读取或打印真实secret值；本检查未扫描已知实际provider key。root负责该项独立验证。

## 二进制逐项检查

- 12张PNG全部直接用本地view_image逐一查看；未上传Library或外部服务。4张夹具明确标合成；8张截图只显示原生Design界面、合成校园取餐原型或版本/返工关系。
- 12个PDF全部用pdftotext提取，并用pdftoppm渲染全页逐一查看；每个均仅1页，正文含“合成”边界，没有login/password/登录/密码术语。没有真人姓名/照片/联系方式或访谈回答；内容为点子描述单和待开展访谈提纲。
- PNG chunk检查只有IHDR/IDAT/IEND及夹具pHYs，没有tEXt/iTXt/zTXt/EXIF附加文本块。
- PDF粗检查未见EmbeddedFile/JavaScript/JS/Launch标记；没有宣称做过PDF规范级的全对象隐写/元数据鉴证。
- 历史检查：每个二进制路径在待推送提交中只有1个独立blob版本；没有不同旧版图片/PDF未经本轮视觉检查随历史推送。

| 路径 | 类型与视觉结论 | SHA256 |
|---|---|---|
| `apps/web/e2e/fixtures/aidt-v2/I1-分区牌.png` | 合成校园取餐/点子示意图 | `ce334fb221a5eb47b03faa490603cda33cfd861c801665557c7201d297b0b2eb` |
| `apps/web/e2e/fixtures/aidt-v2/I2-同伴指路.png` | 合成校园取餐/点子示意图 | `4fbae0a39036ee362a8168a671a8b1aabdc819cdee00ec9e67d87b22bdd5d238` |
| `apps/web/e2e/fixtures/aidt-v2/I3-号码牌.png` | 合成校园取餐/点子示意图 | `12e27b11107b14d6020fbadef9f0d14bb9009578c4be34105961441cb5655124` |
| `apps/web/e2e/fixtures/aidt-v2/SYN-A.png` | 合成校园取餐/点子示意图 | `a7b7307c46648d7c792738d0cff765091779befefd71330ec36650c194a69bef` |
| `docs/evidence/aidt-native/completion-20261116/a5/real-design-stack06-03-402.png` | 原生Design与合成取餐原型截图 | `4ab78a554feee9070c0fd3a0fe5278d935d6334b7919025058acf7b9b4908fe1` |
| `docs/evidence/aidt-native/completion-20261116/a5/real-design-v1.png` | 原生Design与合成取餐原型截图 | `96b5b03d4cc82388ee48962f77e88ed69dec41f27ed7818fca1581505f2c5028` |
| `docs/evidence/aidt-native/completion-20261116/a5/real-design-v2-frame.png` | 合成取餐入口静态原型 | `6d6506d57c4b2341cdb317290429fbe2304de61627d1cb5b5825cf1ff61dccd0` |
| `docs/evidence/aidt-native/completion-20261116/a5/real-design-v2-relation.png` | 合成验收的原型版本关系表单 | `7dd8c31b9565aac1e2a382c63db77b243c4795a1edda9ae372ceafba568f17ef` |
| `docs/evidence/aidt-native/completion-20261116/a5/real-design-v2.png` | 原生Design与合成取餐原型截图 | `c6f728cf2c84fa9009d7a76d32ad7362dd6e1b61fc5b1b38307aa19d2cf7e7ea` |
| `docs/evidence/aidt-native/completion-20261116/a6/fresh-journey-20261117/s4-candidate-1-actual-pdf-b8acbf98ea3e893b5f718c6564bd43fe574101f3.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `80a6a41ddfc9d2cc9f09d29bae0812be00d46361c8383596572f161814d5791d` |
| `docs/evidence/aidt-native/completion-20261116/a6/fresh-journey-20261117/s4-candidate-2-actual-pdf-99c3151d9c0e222536355bc2bd92c60051a44d7e.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `0df05d9a1cb7e4436509aee933881f6be4ed93bf5c7cc0a5208a03ea6e5ea4e7` |
| `docs/evidence/aidt-native/completion-20261116/a6/fresh-journey-20261117/s4-candidate-3-actual-pdf-743fbd1c54a5452603430535b4c74fa23f193c33.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `5920e339b605a385155d1758f4596175bd37b319cef6ae8e775e522251d72728` |
| `docs/evidence/aidt-native/completion-20261116/a6/fresh-journey-20261117/student-reviewed-interview-guide.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `71313b1172c548d348aba50b0b0d0e41d3d88f694b76804c72c970d0ca1cf427` |
| `docs/evidence/aidt-native/completion-20261116/a6/real-completion-20261116/student-manual-interview-guide.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `27a04b9427a18b8c8cc6b61242315b626b8e202ad2c9bd9e2c4c18a9af4e341a` |
| `docs/evidence/aidt-native/completion-20261117/a5/fresh-design/v1-native.png` | 原生Design与合成取餐原型截图 | `61662c988c1852199533b343287a33a2a7dc47be898e9fa93b99284483675736` |
| `docs/evidence/aidt-native/completion-20261117/a5/fresh-design/v2-native.png` | 原生Design与合成取餐原型截图 | `82be49b963dddd0c725fcdef205a44fbd2cb42c15a6a0c1a4b6d51335396279e` |
| `docs/evidence/aidt-native/completion-20261117/a5/fresh-design/v2-relation.png` | 合成验收的原型版本关系表单 | `cd4de21962749f8fa3c57e71f34ede141180c7ea54ceb40ab68d2070925609f6` |
| `docs/evidence/aidt-native/real-browser-acceptance-20261117/samples/idea-1-actual.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `80a6a41ddfc9d2cc9f09d29bae0812be00d46361c8383596572f161814d5791d` |
| `docs/evidence/aidt-native/real-browser-acceptance-20261117/samples/idea-2-actual.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `0df05d9a1cb7e4436509aee933881f6be4ed93bf5c7cc0a5208a03ea6e5ea4e7` |
| `docs/evidence/aidt-native/real-browser-acceptance-20261117/samples/idea-3-actual.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `5920e339b605a385155d1758f4596175bd37b319cef6ae8e775e522251d72728` |
| `docs/evidence/aidt-native/remediation-20261117/a6/iteration-02/samples/SYNTHETIC-idea-1.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `ab7bba937332993af4b1d76df378a822723161c94eeea3524ecb6176713575eb` |
| `docs/evidence/aidt-native/remediation-20261117/a6/iteration-02/samples/SYNTHETIC-idea-2.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `a78ad7270a8014ce93836c1e731ec1fcc4ddc207eb1281aac9124118d7a9b6a6` |
| `docs/evidence/aidt-native/remediation-20261117/a6/iteration-02/samples/SYNTHETIC-idea-3.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `d01b7acad782b0f27a9454a139882845d451306a67013504e9915b15e1663a4b` |
| `docs/evidence/aidt-native/remediation-20261117/a6/iteration-02/samples/SYNTHETIC-interview-guide.pdf` | 单页合成教学导出；无登录/密码/真人资料 | `cedc6b2d18c5b442d4283e1a7725721e9321a8a7e7316bf377cb2729257f4141` |

## 仍需明确的边界

- 视觉检查不是法律意义的公开许可证明；依据是仓库原件/README的合成声明和所见内容。未独立追溯素材作者权利、每个上游生成供应商授权条款或全部文本隐藏信息。
- 审计JSON/日志仍公开了本机路径、验收组织/项目/run/request UUID及测试账务数；未发现访问凭据，但这些是运行审计元数据，不能描述成完全没有运行信息。
- 此审查不等于真实模型教学质量、真人课堂、生产发布、CI或独立代码审查通过。合成验收中保留的历史失败和待结算状态不能改写成通过。
- 原oldrepo六份未跟踪截图未读取、修改、纳入或删除。没有任何推送、PR/issue写入、merge、部署或模型调用。
- 当前用户另已授权PR在CI/审查通过后merge develop；此报告不执行该动作。production继续禁止。
- 不创建专属issue，不重试被自动审批拒绝的issue写入。现有#5649只能作为教学框架背景Refs并显式不关闭，不能声称其是本native feature专属issue。
