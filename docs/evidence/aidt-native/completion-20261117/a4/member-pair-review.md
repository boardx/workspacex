# 当前Web双账号成员文字与组隔离

此前A4新Web免费DraftA/B场景中的成员文字只用同一admin作者，不将其冒称双账号。本次使用与A6 fundedAdmin无关的既有collaboration lead/admin、member/consultant，正常双登录、未新建账号/邀请、未改组织角色或余额。

## 已授权的真实配置前提

[A1只读成员核查](../a1/free-member-memberships.json)确认原seed账号没有共同项目成员关系；同org账号不等于同组成员。root明确批准以独立协作账号在自己的QA范围进行正常产品owner创建→添加collaborator。首场实际正常UI创建shared/private两组，并由owner正常POST collaborators加入现有consultant。GET identity/me和成员名单均实际核对；private组只有owner。这是FR01配置前提的实际操作，不能声称consultant能创建组或拥有组织管理员权限。

## 失败保留与最小QA修正

[首场](member-attempt01-run.txt)5.3秒失败：正常组与成员配置/双登录已完成；旧multiuser helper直连API origin首次GET发生Failed to fetch，尚无成员消息，模型请求为空。[A1只读after](../a1/a4-member-attempt01-zero-model.json)独立核shared 0消息、private 0消息、collaboration tenant的runs/physical/usage/credits/active均0，旧三账不变。不猜该传输失败的供应商原因，也不将其算为产品成员功能失败。

root批准只改QA transport为应用已有同源`/__fullstack_api`，不改CORS、API或权限。第二场复用原两组，先GET严格核owner+collaborator及private非成员，不重建组/重复加成员。旧invite型helper行为不变；新增existing-pair入口复用其既有openChannel/send/readSince及真实合同解析，不走邀请或新身份流程。

## 当前构建的实际通过

[第二场](member-attempt02-run.txt)1 passed，case14.7秒/整场16.3秒，重试0，两context已关闭。产品源`ff9b73ebefa9b05047e918c2018b6d360f90feb3`，Web BUILD `HpTdw6E9Fzu6NgYyCuctM`。主组`prj-b919b4c8-6cf5-4a60-b4b9-f8e9e6b26624`，private组`prj-a711e0d4-e1da-4470-9939-12dde5ed8ad4`。

- 双方通过全局小组讨论UI各发送频道root，再分别单层回复对方，共4条；每次实际200/201回执核当前作者、会话、clientMessageId及threadRootId，双方UI互读stored。回复无嵌套话题入口。
- 两作者各自正常授权GET回读，4个clientMessageId都只有一条对应记录。刷新按当前约5秒拉取实现，未放宽为无限等待。
- private组owner正常写入合成canary；未加入该组的consultant GET频道、GET话题、POST写入均404/NOT_FOUND且不泄漏正文，owner回读仍仅canary。
- 两context在登录前注册生成POST abort，成功场景实际生成请求列表为空；没有模型请求需要伪响应或假事件。

[完整安全机器证据](member-attempt02-browser-machine.json)。[A1独立app_rw after](../a1/a4-member-attempt02-after.json)确认**只在本次collaboration tenant**：runs/physical/usage/credits/active全0；shared真实4消息/2作者、private1消息/1作者，两project runs0，旧三账hash不变。不把主org正在进行的收费S2误称全栈0。

## 源与验证范围

独立`aidt-member-existing-zero.spec.ts` + `playwright.aidt-member-existing-zero.config.ts`，默认关闭、单worker、0retry、120秒上限、无webServer，默认/fullstack精确排除，paid-v2文件模式不匹配。只添加QA existing-pair helper和配置，不改生产Chat UI。运行凭据来自实际seed单源并仅在进程内存传入，不写证据或输出。

本次不证明课堂规模并发、教师教学质量、在线人数/未读/已读、语音或P2P，也不替代真人研究。无生产部署、无新构建/服务启动、无Library或人工PDF修改。

最终准备与源检查：[scoped TS](member-spec-types.txt)退出0、[5文件ESLint](member-spec-lint.txt)退出0、[独立list](member-spec-list.txt)仅1项、diffcheck0。[源hash与边界](member-source-checks.json)记录本次QA文件快照。
