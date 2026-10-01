# 组织首页设计检查（Refs #4881）

final result: blocked

Source visual truth: 用户附件 codex-clipboard-7eede8a6-1e9e-468b-9476-b68ed2f70546.png（1536 × 1024，首页与后台同屏）。附件在对话中可见，但所给 macOS 本地路径不在云工作区，无法制作与实现同视口的合并比较输入。
Implementation screenshots: docs/evidence/org-home-theme-4881/home-desktop.png、settings-desktop.png、home-mobile.png。
Viewport: desktop 1440 × 1024、mobile 390 × 844，deviceScaleFactor 1。
State: 已登录组织管理员，隔离 API fixture；Logo 上传后自动配色、手动改色与保存、预览、窄屏首页。

## 观察与修改

- 字体与层级：保留现有产品字体；检查中发现 text-32 不存在于产品字号配置，改为明确的 36/44px 品牌标题并重新截图。
- 布局：四列快捷卡片；后台外观/内容/布局标签，保留真实后台导航。窄屏无水平溢出。
- 颜色：六个语义色可编辑；后台预览与首页共享 CSS 变量映射。按钮前景按对比度选择；快捷卡片由品牌色生成浅底。
- 图像：Logo 复用真实组织头像，并通过鉴权 Blob URL 显示；横幅沿用用户上传图片。未复制附件中示意的蝴蝶、山水及成员头像作为产品默认素材。
- 文案：使用组织配置与真实数据；空工作列表如实显示空态。

## 证据与边界

主交互通过浏览器检查，未发现 pageerror。截图见上述文件，浏览器记录见 browser.json。源图与实现的状态/数据和后台呈现方式不同：参考图同屏抽屉，产品是独立后台页。尚未完成同视口合并图的严格视觉比较，不能声明像素级还原通过。

## 后续验证

- 在可访问源附件的环境完成同屏比较。
- 在数据库镜像可构建的环境运行真实数据库授权与主题持久化测试。
