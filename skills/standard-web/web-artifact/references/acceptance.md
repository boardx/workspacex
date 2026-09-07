# 网页产物验收记录

在 `test-record.json` 中记录以下字段，不得用“看起来正常”代替实际结果：

- `sourceFiles`: 路径、SHA-256、读回结果。
- `bundle`: `/workspace/web-artifact/bundle.html` 的 SHA-256、字节数、读回结果。
- `preview`: 两个保留的 run 隔离 URL（`preview.workspacex.invalid` 的 desktop/mobile）；记录 adapter 从当前 workspace 读回并临时装载的结果。它们不是公网 URL。
- `desktop`: 视口、结构快照、主要按钮、表单、空状态、横向溢出结果。
- `mobile`: 固定 390×844 视口、横向溢出和主要操作结果；必须与固定 1280×720 desktop 分开导航和截图。
- `network`: 一个允许请求和一个未授权请求的实际结果；未授权请求必须没有副作用。
- `screenshots`: workspace PNG 路径、尺寸、hash、读回结果。
- `artifacts`: 每个文件的 staged/ready/failed 回执；不得把 staged 写成 ready。
- `limitations`: 未跑真实浏览器、缺少依赖、预览不可达等边界。

最低通过要求：主要按钮和空状态可从结构快照定位并实际操作；填写多个字段后值正确；页面变化后旧 ref 被拒；桌面与移动视口无横向溢出；未授权网络请求被阻断；截图和交付文件真实可读。任一项没有证据时，该项不得标 `passed`。

每项记录 `status`（passed / failed / not_tested / not_applicable）、`actualToolEvidence` 与 `limitations`。`not_applicable` 仅用于场景确实没有对应对象（例如无表单时多字段填写）；不得用它取消仍需证明的安全边界。未跑的旧 ref 拒绝、网络拒绝、视觉查看必须明确 `not_tested`。结构快照不包含水平溢出的几何证明。完整通过需要补齐最低要求中适用的实际证据；有未验证项时交付可以是部分完成，不能称完整验收通过。
