# 私库来源连接：导入前后的完整体验（待签核）

现状：SkillImportRequestSource 已有 authConnectionId；导入原型只有演示选择器。仓库中尚未找到业务开发空间的连接生命周期 API，不能把协调平台 GitHub App 凭据复用给产品用户。

## 推荐交互

导入向导旁放“连接 GitHub”，后台发起授权事务并记录本组织、当前用户和原向导上下文。用户在 GitHub 选择允许的仓库，回到 WorkspaceX 后只看可用连接和获授权仓库；地址、ref、目录范围保留，重新预览才继续导入。授权取消不丢表单，授权失败不创建半可用连接。

推荐使用 GitHub App 的仓库内容只读授权及选定仓库范围。GitHub 官方说明其权限可细分到 repository contents，安装访问令牌有效期有限；令牌轮换属于服务端职责，不让用户按小时重新粘贴密钥。[GitHub Apps 与 OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)

授权人的 GitHub 可见范围与 App 安装范围必须共同决定可选仓库，不因某个 WorkspaceX 组织管理员能管理连接，就把安装下所有私库暴露给他。GitHub 的 user access token 受用户与 App 权限交集限制，可用于确认这层归属。[GitHub App 用户访问令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

这是设计推荐，尚未创建或安装产品 GitHub App，也未申请额外账号权限。具体安装主体和回调域名需纳入签核部署材料。

## 必须补的操作边界

| 操作提案 | 输入与返回边界 | 失败/恢复 |
|---|---|---|
| listSourceConnections | 当前组织可用连接的ID、显示名、允许的来源类型、状态；不返回令牌/内部安装凭据 | 跨组织不可见；空态可开始连接 |
| beginGithubSourceConnection | 服务端生成一次性授权事务；仅接受内部回跳目标标识，返回受信GitHub授权URL | CSRF/state绑定当前会话、组织与发起人；不接受任意returnUrl |
| completeGithubSourceConnection | 服务端校验回调state/code并读取真实安装/用户范围；不能凭客户端installationId直接绑定 | state过期、重复、跨会话、组织切换均拒绝；完成后凭原事务回向导 |
| getSourceConnection / listSourceRepositories | 读取当前可用状态与授权仓库清单；分页，实际外部权限复核 | 授权变更后旧仓库不可继续读取；403与限流区分，不将403全当凭据失效 |
| reconnectSourceConnection | 新授权事务保留原连接关联，但不把失败候选覆盖原连接 | 成功后更新版本；旧预览重新校验权限，不复用过期授权证明 |
| revokeSourceConnection | 组织admin明确撤销；CAS，审计连接ID/操作者/时间，不记录secret | 阻止后续来源出站；进行中任务在下一边界终止或返回明确失败；已导入草稿不被删除 |

上述名称仍为提案，必须进入可执行契约并与既有 identity/security 评审后才能作为正式覆盖。连接状态、事务错误、有效期、仓库范围结构不能只写文案；按现有 closed enum/defineOperation 方式补齐。GitHub App token生成、安装webhook验证、密封存储属于后端实施，不在浏览器原型中伪造成功授权。

## 导入和更新的联动规则

1. 输入authConnectionId只是选择引用，后台仍校验当前用户/组织、连接、仓库、路径与操作权限后才出站。
2. 同一连接续期不改变来源commit/digest；连接范围变化不能让原预览悄悄改扫其他仓库。
3. 撤销连接不破坏已保存的来源血缘与已发布版本；后续检查上游显示“需恢复来源连接”。
4. 上传ZIP不依赖GitHub授权，仍执行上传归属/资源限制；HTTPS单文件不得把GitHub令牌转发到任意域名或重定向目的地。
5. 对跨组织连接、CSRF、回调重放、撤销后重试、仓库范围缩小和敏感日志分别做HTTP/数据库/出站计数反例。

## 2026-09-10 可执行草案增量

`packages/contracts/src/skill-source-connections.ts`已定义个人只读来源连接与10项操作，未加入生产index。第一版采用“当前组织内、仅本人使用”的连接提案；不因组织admin角色默认继承他人的GitHub安装范围。前文共享连接的授权交集是未来若支持共享时的额外设计要求，本草案scope只允许personal。需在同一次签核中确认这项默认；不自动改变现有业务权限。

授权事务经过pending→select-repositories→completed；GitHub回调只能进入选仓或失败，不能替用户完成选择。没有安装/无仓库权限时保留明确失败出口，不能用installation token替代用户已失效授权。取消为明确终态，重连与撤销带版本。令牌、verifier和安装凭据不进入客户端输入/返回。

授权URL校验GitHub精确origin/path、state存在和S256 challenge；服务端仍必须验证它是本事务生成的URL、注册的redirect_uri、一次性state/PKCE、当前会话/用户/组织及真实仓库范围。结构测试不证明CSRF或权限已经实现。参考GitHub官方用户授权流程：https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app 。

读连接、读事务、确认/取消和撤销的请求/响应对有标识校验；正式服务还必须将用户选仓与持久化授权清单精确比对，仓库范围变化不能静默扩大。新错误集合须随接口接入统一HTTP reasonCode映射，并对回调code/state查询串做日志脱敏。当前4项测试只证明结构拒绝和关联边界。
# 私有来源交互与恢复补充（2026-09-10）

`/preview/ai-capability-studio/connections` 是独立fixture，由导入页明确标为演示的链接进入。流程为开始→模拟回调→默认无选择→确认仓库→个人连接。拒绝、过期、取消可重新开始；重授权失败不替换已有连接，成功以相同ID的下一个revision和本次明确选择替换范围。撤销只影响后续来源读取，不删除已有草稿。返回工作台使用真实 `/workbench` 路由，不传递演示授权状态。4项组件测试及实际浏览器已验证主要路径；本轮浏览器记录见 browser-review-2026-09-10.md。

复审补强：事务revision与连接revision分离，callback绑定服务端未核销state、先前authorization URL中的state及请求state，统一32–512长度；confirm/cancel精确CAS。所有元数据关联校验只是adapter采用前的契约要求，不能替代真实OAuth会话校验、数据库原子核销、仓库授权快照校验或凭据加密存储。
