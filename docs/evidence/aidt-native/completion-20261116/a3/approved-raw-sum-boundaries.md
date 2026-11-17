# 已批准 Raw / SUM 的本轮真实边界索引

2026-11-16。此索引只汇集本轮实际执行的批准范围复核，不把待人签核的上下文方案算作已实现。机器索引见 [approved-raw-sum-index.json](approved-raw-sum-index.json)。无新付费模型调用、无生产部署、无成员/角色/信用/RLS改动，专用合成组和原件保留。

## 新发现及已修复的去重错误

最小反例：同样字节先以 `confidential=false` 上传 A，再以 `true` 上传 B，再次以完全相同的 `true` 请求上传 C。原实现先从整个 project 查最早 hash 匹配 `LIMIT 1`，再过滤该 A 的保密/范围；于是兼容的 B 永远查不到，C 被误建为第三个 artifact。

[红测](raw-compatible-dedup-red.txt)准确失败。仅在 AIDT 内部事务 port/Pg adapter 增加 `findReusableVersion`，把当前可见集合、scope、confidential、agenda、pipeline/parser 及 hash 的条件移到 `LIMIT` 前。F35 的实际安全扫描/字节校验、普通 Files 的 repository/公开合同、现有权限均不改；选择的 ID 仍再次经 artifact ACL 检查。修后同一反例通过，且下面的真实 HTTP/PG 复核也命中 B。

“使用已有版本”沿原生 F37 的最早兼容匹配语义，**不承诺总是返回最新 head**。学生明确“另存新版本”才实际追加 immutable version。内容去重也不等于整个 POST 的 exactly-once：既有上传合同没有操作幂等键，每次提交仍产生独立 run receipt/提交时间；前端已拿到 receipt 的回读重试仅 GET，不再次 POST。

## 实际验证层

| 范围 | 已观察事实 | 本轮证据 |
| --- | --- | --- |
| 合并后端定向组 | 5 文件42项通过：Raw核心21、controller14、SQL-port投影1、真实SUM包/实际授权importer内存ports6；不是42项PG测试 | [approved-raw-sum-unit.txt](approved-raw-sum-unit.txt) |
| 架构与权限路径 | 新去重实现之后重新执行：2303文件依赖向内；2308文件tenant guarded读路径通过 | [architecture](approved-raw-sum-architecture.txt)、[permission](approved-raw-sum-permission.txt) |
| 普通学生/owner新建组 | primary通过正常API创建general组201，但同一principal自行加AIDT标签实际403；新建回执仍只有id/kind/status，既有P3 provenance缺口未冒称通过 | [raw-primary-profile-denied.json](raw-primary-profile-denied.json) |
| 教师/管理员准备profile | root单独授权的既有primary org admin，先核真实org/角色、普通GET精确目标组、保留原tags，再只PATCH这一专用组profile200；随后结束admin上下文，原件全由primary真实owner上传 | [raw-admin-profile.json](raw-admin-profile.json) |
| 中文文件名/真实原件 | 4次真实multipart上传201；正常metadata均agenda=null，原始字节、SHA256、按字节sniff的text/plain、artifact/version IDs、提交者和时间均实际GET核对；客户端故意提供的Content-Type未被信任 | [HTTP记录](raw-http-before-pg-supplement.json) |
| 同字节兼容去重/显式新版本 | false A→true B→true C实际复用B的artifact/version；第4次明确new-version生成B的真实V2。4个receipt独立，旧B receipt仍指V1、字节与旧提交时间不变 | 同上；[PG精确绑定](raw-pg-readonly.json) |
| 真实PostgreSQL | 核验runtime isolation后以`migrationConfig`连接正确测试DB，`BEGIN READ ONLY`参数化SELECT：2 artifacts、3 versions、4 run receipts、3 pending outbox；普通Q组0artifact；两组0 agent_run。原始hash、组合version hash、提交者及时间逐条对齐HTTP | [raw-pg-readonly.json](raw-pg-readonly.json)，含实际参数化SQL |
| 原件表安全属性 | 真实catalog查得RLS+FORCE开启，app_rw可SELECT/INSERT、不可UPDATE/DELETE；这是已存在安全属性复核，没有修改权限 | 同上 |
| 实际拒绝边界 | 错SHA与非null agenda均422；EXE改名PDF为422/MIME_MISMATCH；普通非AIDT组上传404；同owner传错project的content404；匿名401且无原件/提交元数据头 | [HTTP记录](raw-http-before-pg-supplement.json) |
| 既有GET合同与content附加scope | GET run省略project查询仍200/STORED；新增content省略project明确404；原receipt的version与提交时间重读不变 | [raw-http-final-reads.json](raw-http-final-reads.json) |

初次混合脚本在上述HTTP断言全部通过后，使用容器默认DB的SQL启动路径中断；原记录的 `completed:false` 和 `CalledProcessError` 原样保留。随后按A1提供的隔离核验及应用测试DB配置，独立只读PG补验成功。没有为得到绿结果重发4次上传，也没有删除原失败。

提交信息来自**本次真实上传回执**的`created_by/created_at`，不是读取人、原文件作者或原版本创建者。当前实际HTTP为同一primary提交者；“另一当前成员读取仍保持原提交者”和“不同提交者重复上传有独立提交元数据”目前证据为后端ports/controller层，不假称本次已经用第二真实成员验证。

## 必须保留的未完成或未验证边界

- 本轮HTTP未验证跨成员/跨租户/撤权竞争；相应代码和内存反例不替代真实双成员场景。
- primary是普通consultant owner，其正常archive请求实际403；没有借admin做归档。因此本轮不称“真实归档后可读原件、禁新上传”通过；该分支仍只有既有单元覆盖，等待既定实际场景。
- HTTP可读响应头不等于浏览器跨域可读。本轮没有启动浏览器，旧Web还是较早生产快照；最终UI、5个回执头的允许origin曝光、换身份、重登录与重启回读仍需最新Web验收。
- Raw仅保证原件与真实回执、STORED/outbox排队；没有启用抽取worker、转写、索引或模型分析，不把可下载当READY或研究证据成立。下游INGESTION_FAILED仍可经正确授权读取完整原件，前端只对准确422/该码回退，其他错误不回退。
- 仅每请求一个文件。批量在transport或service被拒绝；不能宣称完整Files批量部分成功合同通过。两个AIDT_UPLOAD_*补充拒绝原因不在签核封闭enum，全局filter保持通用422，不加任意字符串白名单。
- 既有物化流程可能在DB提交失败时留下无引用对象；没有新增物理删除通道，也没有声称自动清除孤立字节。

## SUM 当前事实

真实独立包`aidt-project-summary@1.0.0`、stableName `dt-summarize-project`已开发并由既有bootstrap实际出现在隔离目录；本次6项包/importer测试验证源字节、不可变旧六步包不变、opt-in、授权/重放/拒绝，不等于真实总结输出质量。

原生Chat总结线程、六步材料/有界历史读取、主动带入composer、实际agent/run消息或关联artifact的审阅导入、保留学生原文、显式保存/导出均已有界面/逻辑及相应定向测试。历史消息的生成配置未逐条核验，不能据当前mount宣称所有旧消息都由该SUM版本生成。

**确定的软件缺口尚未解除：AG-UI桥忽略`body.context`。** 浏览器useAgentContext材料出现在wire不证明后端/模型收到；已用真实controller无网络反例复现。已补六步标题/任务/产出元数据38项通过，也不能据此称材料送达或S1误识修好。服务端selector、精确版本回读、immutable snapshot与应用回执方案见[待签核束](../../../../design/aidt-native-context/design-signoff.md)，当前仍pending，未提前写核心契约/pipeline。

本轮没有额外SUM模型调用，不把曾经S1的学生修卡成功、SUM包安装或报告存档当SUM真实验收。真实生成内容、教师点评来源、完整多轮学习报告质量和最终PDF/Word文件交付仍按各自实际证据说明，不能以此42项测试代替。
