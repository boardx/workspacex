# 四数字人与实时语音验收进展（进行中）

用户最新授权：PR问题必须修复，检查全绿后合并Main；不部署。协调注册按用户要求跳过。每角色独立9/10及全部硬门才交付，目前无角色通过。

R1基础模型：issue5124，PR5128已全绿+独立review后合并Main e4ce1c30cf6f0e4bdf5f15b514cb830d8924f6e3。三云端语音补丁已取回。真实qwen3.8-max文字、qwen3.8-omni-flash-realtime实际PCM输入及模型PCM输出验证成功；夹具音频由真实模型生成，不是真人10轮/P95验收。采音恢复、统一Chat配置、测试专用composition及真实启动目录初始化修复；24项非跳过CI绿。临时本地栈已停止，无Docker。

R2研究：issue5185，PR5198。线上D002升级官方1.5→1.6恢复身份，直接Skills仍0。原模型选错W029被拒绝；人工保存草稿可开/整页刷新恢复。明确给W001后真实实例6ab3c865-f73f-43ac-9739-83a11108efbd已创建、范围gate通过，但draft正文空，review被测试者拒绝，publish/distribute未执行。实际production W001仍占位图，无真实研究Skill产出。修复精确verified技能绑定补齐、固定workflow白名单及当前目录提示；CI先暴露重复semantic_label唯一约束500和薄网关行数失败。最新286a52789（独立复核）包含9ec3fdf78修复binding版本标签与上下文模块提取，以及真实PG测试SELECT semantic_label字段补齐，本地33条/类型/lint绿，独立review接受；新head真实PG及全量CI仍待通过，未合并。所有截图/输出/反证在r2。

R3产品：issue5200。线上仅D003升级1.6；介绍正确但复述无关历史、强制确认。合成PRD任务未执行W029，错误日期、0基线、预算/ROI/口径错误，virtual write_file返回后产物为0。人工落地草稿后打开/整页刷新恢复成功。基线5.75/10，硬门不通过。修复只读介绍分类、上下文隔离（不删历史）、纯介绍执行工具抑制、服务端时间和专业声明边界。API32条（26executor+6薄网关）、Python93条通过；真实Qwen同句介绍隔离后不复述兴趣；同专业任务时间/兴趣改善但预算/ROI/转化率等仍失败。详见r3/report.md，不能将提示或直连文字探针当端到端验收。

R3 PR5215 draft基于R2，最新f83cb5fd7独立review ACCEPT。R4设计issue5216：D011真实W031停预注册，未批准上线；阶段正文空。专业文稿虚构成本、日期、动机；write_file后产物0。修复native无附件交付指引，source99f7068a6独立ACCEPT，74passed/3skipped，线上未部署。人工草稿保存只保留最终完成摘要，不含75行专业正文，不能作为专业产物通过。R5集成（D005内部/真实语音/Skill验证/workflow真实产出）待继续。未部署的修复不能算DevApp复验通过；真实10轮麦克风需用户后续配合，当前P95不可报成功。


2026-10-03 R5：R4 PR5223 draft，最终4828fa89f；R5 issue5224，复用R4 checkout并切codex/digital-acceptance-r5（新建worktree因磁盘不足回滚）。闭合[S1]/[T1]来源过滤source f979e25a9独立ACCEPT，实际executor35/35、API typecheck通过；另33/33 scope/voice unit仅模拟管线。D005 W001真实服务端拒绝未建实例；首次服务退出，同例重试保留反证；人工草稿68行全文全刷新恢复，但自主正式产物0、错误2024日期、0 ready/14 pending Skills，暂7/10未通过。真实固定Qwen realtime十次同一音频fixture交换PCM，P95接收首包873ms，不是十轮自然真人交谈，也不是停顿到播放首音；打断延迟仍未测。其他角色暂5/5.75/4.75，均未达9且硬门失败。用户已授权修复PR并合并Main，不部署；逐父PR合入后保留子delta、重新review新SHA与CI，不并行争抢merge。证据evidence/digital-acceptance-20261002/r5/report.md。自身无运行服务/模型socket；R2闲置.next/cache534M在重新lsof及四个自身端口无消费者后已清除，Data514Mi→1.0Gi，不触碰他人/生产/DB。
