继续唯一worktree，当前分支codex/research-5142-source-documents，依赖#5134 reviewed730837238。只改source relevance与共享引用schema导出和其受控模型fixtures；public schema未改。代码已实现，11针对测试及202单元通过，typecheck最终通过。完整suite35文件440通过1timeout；单独重跑beforeAll超时44skip，不能称全部绿。真实公开source复测两次provider失败，没有质量/速度PASS。环境超时墙钟15m+/90s配置冲突未诊断，禁止推断唯一原因或无限重跑。

不要合并main，不要关闭#5056或改passing/signoff。前五PR在最后check全绿，#5087/#5110外部已合并，本会话未合并；后续必须刷新state/head，不依赖静态记录。

自己的with-test-isolation栈已自动cleanup（最新1秒），模型诊断子进程退出，无生产writes。无凭据入文件。待exactSHA review，若创建draft PR必须写清验证缺口，并对CI负责到绿。
