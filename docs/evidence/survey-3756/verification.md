# 问卷与报告模板库恢复 — #3756

恢复问卷列表、问卷模板、报告模板三个入口。模板独立存储，不带答卷或发布状态。报告模板应用前显式对应题目；复制后与源模板独立。失败保留输入，版本冲突可另存副本。

验证（2026-09-21）：
- `./init.sh` 基础验证通过。
- API 模板 CRUD + canonical 权限测试 32 项通过；扩展组织冻结后模板 3 项通过。验证 owner/tenant、版本冲突、kind 不可变、非法输入与冻结读写。
- 261 个数据库迁移双次重放通过，schema/data 一致。
- Web 8 个测试文件 48 项通过（导航、路由、读写、失败保留、显式映射、防重复提交、共享离开保护）。
- API/Web TypeScript、权限 lint、修改组件 ESLint 通过。
- 实际 PostgreSQL + API + Next + Chromium 浏览器：创建/修改/刷新模板、模板创建问卷、保存报告模板、显式绑定应用并保存刷新、修改源模板不影响问卷、复制/删除、拒绝侧栏/浏览器后退保留编辑。

浏览器复现命令（仅允许隔离本地服务）：

```sh
SURVEY_API_URL=http://127.0.0.1:<api-port> SURVEY_WEB_URL=http://127.0.0.1:<web-port> node apps/web/scripts/survey/template-library-check.cjs
```

测试使用开发模式预设账号；不读取或更改线上用户数据。截图为本地测试数据。

兼容范围：侧栏跳转和原生卸载均保护未保存输入；SPA 历史导航的取消依赖浏览器 Navigation API，旧版不支持此 API 的浏览器不保证后退/前进保护。
