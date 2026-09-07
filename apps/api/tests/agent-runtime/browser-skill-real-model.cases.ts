export const browserScenarios=[{id:'S013',packId:'standard-web',packVersion:'1.1.2',skill:'web-artifact',filename:'brief.txt',
source:'Synthetic task: a bilingual local counter. Initial count 0; one Add / 加一 button. No user data and no external requests required. Offline only. Desktop and mobile must remain legible.',
prompt:'根据附件选择合适技能创建离线自包含网页：双语计数器初始0，点击加一变1，清零恢复0，显示空状态说明。用真实受控浏览器验证交互、桌面和移动视口并截图；不要把源码检查当浏览器验证。交付 bundle.html、源码 index.html、test-record.json、桌面和移动截图以及 report.md，报告只声称实际完成的检查。不要联网安装依赖或部署网站。',
required:[/计数|counter/i,/桌面|desktop/i,/移动|mobile/i],forbidden:[/已部署到公网|生产网站已上线/]}];
