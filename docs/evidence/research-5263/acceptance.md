# 研究返回列表位置验收（#5263）

基线 caf445c3c65eab8e614ea9ecd60cfaa112879f46。只修改研究专属 GuidedResearchSixStepShell；所有真实new/import/topic/plan/research/chapters/report与恢复错误状态复用此壳。没有修改跨模块共享样式或业务导航逻辑。

将唯一返回入口移到标题之前、与标题左边缘对齐。保留 onBack/requestLeave、data-testid、未保存确认和步骤逻辑；不新增入口。

验证：
- unit六步、reference-layout、step-transitions三个现有spec：37/37通过。
- web typecheck退出0。
- 实际CUA本地Next应用：/research/new桌面1280×720按钮(x32,y69,w138,h40)，标题(x32,y125)；手机390×844按钮(x16,y69,w138,h40)，标题(x16,y125)。按钮唯一、elementFromPoint确认无遮挡。
- 桌面输入公开合成草稿，点击左上返回出现“研究内容尚未保存”；继续编辑保留8字草稿；放弃修改并离开进入/research。手机空新建点击返回进入/research，随后因本地未登录正常跳login?next=/research。未登录列表内容不计业务PASS。
- 六阶段共用壳在桌面与手机逐个实际点击步骤导航，并测量按钮：全部与上述坐标一致、唯一且无遮挡。使用明确标识固定示例的prototype-fidelity视图，只作为布局验证，不冒充真实检索/报告或已登录业务链路。
- 真实报告路由恢复状态也呈现相同左上按钮；本地未配置业务API，已登录已有报告返回路径未动态认证。现有导航回归覆盖onBack，位置改动没有改跳转目标；线上部署不属于本PR。

截图：desktop-new.jpg / mobile-new.jpg / desktop-unsaved-dialog.jpg / desktop-report-preview.jpg / mobile-report-preview.jpg；十二阶段几何观察layout-observations.json。

独立审查、PR与远端CI待完成。不自行merge/deploy。#5056全按钮验收继续，不因布局PR标全量通过。
