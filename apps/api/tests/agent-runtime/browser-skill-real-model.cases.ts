export const browserScenarios=[{id:'S013',packId:'standard-web',packVersion:'1.1.2',skill:'web-artifact',filename:'brief.txt',
source:'Synthetic task: a bilingual local counter. Initial count 0; one Add / 加一 button. No user data and no external requests required. Offline only. Desktop and mobile must remain legible.',
prompt:'根据附件选择合适技能创建离线自包含网页：双语计数器初始0，点击加一变1，清零恢复0，显示空状态说明。严格控制在25次模型调用内：用一次 execute 批量创建、完整读回并计算所有文件 hash；同一轮可并行的发布调用一起发出，避免重复读文件。用真实受控浏览器验证交互、桌面和移动视口并截图；页面变化后真实提交一次旧 ref 并记录拒绝；真实尝试一个私网 browser URL 和一次沙箱脚本网络请求并记录策略拒绝，不得用文字声明或“没有请求”代替。交付 bundle.html、源码 index.html、test-record.json、桌面和移动截图以及 report.md，报告只声称实际完成的检查。不要联网安装依赖或部署网站。',
required:[/计数|counter/i,/桌面|desktop/i,/移动|mobile/i],forbidden:[/已部署到公网|生产网站已上线/]}];
