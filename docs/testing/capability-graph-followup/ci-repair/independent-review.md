# #5389 CI 最小修复独立安全审查

读基线 capability-pr HEAD 7058d9a1c。首次核查时两仓储仍 import 独立 read-published-skill-pins 文件；因此移动到目录文件 export 的方案尚未逐行验证，不能把设计审查当成新版本验收。

## 现有真实认证/隔离链
- Kernel 全局 PrincipalGuard 调用 PrincipalResolver；失败 503、空 principal 401，不降级放行。
- AgentController.getCapabilityGraph 首句 assertPrincipal；org 仅取 principal.orgId，route 只接收 agentId，没有 caller org 参数。
- 原只读 graph 的业务规则是已登录组织内读 metadata；未新增 admin gate 并非写权限放宽。create/clone/list/instructions 原有 admin gate 必须继续保留。
- Pg graph 在 withTenant(org) 内 WHERE a.id=$1 AND a.org_id=$2；LEFT JOIN v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id。精确 instance 当前发布版本，不能替换为 latest/template/default。
- pin lookup 保留 skills/versions同org join、调用者org或固定platformorg、精确数组ids、sv.published；unresolved仅提示，不变可执行pin。
- 移入 existing directory repository export 复用 SQL 不需要新权限豁免，也不改变授权。directory不import create，可避免循环。

## 实跑本地独立反例
controller-scope.test.ts 3 PASS，exit 0，21:58:21：空principal未触发repo；额外requestedOrg无法覆盖principal.org；missing/foreign结果同404。只synthetic actualcontroller调用，不证明新SQL真实RLS。

## 应补实质 guard 反证
1. create/clone/list/instructions任意原方法加入JOIN agent_versions/skills等表应失败，不得全文件整体扩大allowlist。
2. graph只允许agents+agent_versions；插入JOIN skills/privileged表应失败。
3. graph依次删除current version、agent id、org id任一join条件，guard应分别红；WHERE org被移除也红。
4. pinhelper只允许skills+skill_versions；去掉published、skill/version org一致或tenant/platform谓词应红；platform不能来自caller输入。
5. 任一来源引入withoutTenant应红；解析失败/未定位到目标method必须失败而不是空表集合通过。
6. 区分注释中的FROM与可执行SQL。最好抽method后只扫描字符串SQL，包含装置selfcheck防恒空。边界提取不能靠method后slice到EOF让graph查表污染list。
7. 原已存在HTTP跨org404/零版本图legacy兼容继续回归；有真实测试环境时还应验证坏agent_versions指针跨agent/跨org、foreign/private skill、unpublishedskill不解析。当前未访问DB。

无新增模型调用、DB、授权、部署；未改capability-pr或共享文件。

## 新树落盘后复核（22:02–03）
Root 已落盘 helper move 与 guard 修复。已逐行复核 pin SQL 未改变；新 projection 是严格两列等值，graph 与 nonGraph 表范围分别有检查，旧新增 exemption 已移除，不增128上限。新controller静态body边界已修正。

独立复验：复制原新 guard，仅将读路径绑定真实 capability-pr，15项 + actualcontroller3项 =18 PASS，exit0。再次只在 mocked读取中给pin SELECT 加sk.description AS extra，原新 guard 正确拒绝：1 FAIL/17 PASS，exit1，唯一失败为 pin projection mismatch。该预期失败证明先前projection缺口已修复，不是新树失败。配置 baseline.config.mts 是通过基线；vitest.config.mts含有故意变异反例。

未发现新授权扩大或租户绕过。以上仅本地源码/actualcontroller假仓储测试，不声称真实DB/RLS或native验证。
