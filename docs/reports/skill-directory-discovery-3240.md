# Skill 子目录发现修复验证

工单：#3240，属于 #3234 后台导入体验升级的一个独立修复。基线 main@82589c9157ca982f8edb1fe9149fd5cca7d0e3d4。

## 用户可见行为

扫描入口收到已含 SKILL.md 的 GitHub 子目录时返回该目录本身，用户无需切换单目录导入模式。保留文件数近似计算、无 frontmatter 时目录名兜底、兄弟目录隔离和 Skill 资源子树不继续发现。

范围：现有候选契约要求非空 dirPath，所以本修复不为仓库根发明特殊路径；根 Skill、ZIP、私库及草稿发布链仍在 Phase 15 设计范围内。

## 先红后绿

在旧实现上，将直接 Skill 子目录及无 frontmatter 子目录设为验收输入：9 项测试中 2 项失败、7 项通过；两个新增失败均为 IMPORT_NO_SKILLS_FOUND，命中实际问题。

修复后命令：

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/skill/discover-skills-from-url.test.ts tests/skill/discover-skills-http-route.test.ts
pnpm turbo run typecheck lint --filter=@repo/api
```

结果：2 文件、17 项用例全部通过；Turbo 5 项任务成功（3 项依赖缓存），API typecheck/lint 通过。发现用例走真实 HTTPS loopback，HTTP 路由用例使用隔离数据库。测试栈自动清理。

## 验证限制

没有调用 GitHub 公网进行手工导入；未证明新 Phase 15 全旅程。首次直接运行 API tsc 因冷工作区缺少 fabric-markdown dist 类型而失败；使用标准 Turbo 依赖构建后通过，未放宽后端 DOM 配置。PR CI 和独立评审完成前不宣称交付。

## 独立审查修正

审查 exact SHA cc695a3bc 发现：起点 SKILL.md 的 download_url 为 null 时，布尔返回值把“有标记”误当成“候选加入成功”，提前返回并漏掉有效子 Skill。新增真实 HTTPS fixture 反证：修改前1项失败（IMPORT_NO_SKILLS_FOUND）、9项通过。

修正为 absent/unavailable/added 三种结果：起点只有实际added才结束；子目录沿用原有包边界。修复后同一隔离命令18/18通过（发现用例10项、HTTP路由8项），数据库 wsx_c880605a920f5a891e0d，隔离栈退出时已清理。权限检查和SSRF取回链未改动。新SHA仍需CI与独立复审，未自行合并。
