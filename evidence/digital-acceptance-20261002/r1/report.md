# R1 基础模型与语音修复验收（2026-10-02，Asia/Shanghai）

基准 main：75addf4923c2ca550e3f8e313a3d1563fcc61489。第一轮 issue #5124。
共享主目录 main@40238a5cd 有大量未提交改动；本轮隔离到 /private/tmp/wsx-digital-acceptance-20261002。

## 已实测

- init.sh 快速路径 exit 0。
- 真实 qwen3.8-max 文本：HTTP 200，返回「连接验证成功」。配置只从 cn.local.env 读取，未输出或入库。
- 真实固定 qwen3.8-omni-flash-realtime、Maia 音色：文本输入生成130560字节 PCM；realtime-probe.json、realtime-output.wav 保存实际输出。
- 实际输入87040字节PCM，真实模型返回157440字节音频、「收到，语音连接验证成功。」；audio-input-probe.json、audio-input-response.wav 保存输出。输入夹具来自前一个Qwen实际生成的语音并降采样至16k，未使用模拟模型；不声称物理麦克风或真人通话通过。
- 首次探针使用Cherry音色，被模型拒绝；改用仓库默认Maia成功。这是探针配置错误，不是产品默认音色缺陷。
- 系统say生成的WAV只有头部，空PCM被供应商拒绝；保留audio-input-empty-fixture-failure.json，换有效实际音频后复验。
- DevApp已登录，D002通话连接、静音与挂断可见；麦克风音量0，无说话内容，页面提示未保存记录。截图已保存，不能据此判定真实双向通话、持久化或设备释放通过。

## 修复来源与范围

云端既有三提交59efa93a3、b0267bff1、f9be6afe4：校验补丁交接压缩包SHA256为329e5b7bff07d7314244716bc558dcd7ddc2eeb9a2af3d027d2f56eb368a8b87。主代码应用；配置回归按当前main适配。未复制整条私有分支。

采音在返回句柄前resume并验证AudioContext running，失败清理轨道/context。生产realtime只复用Chat URL/key，固定POC模型；专用测试composition以函数参数注入本地供应商，生产不读取测试端点。

## 未通过边界

四角色专业任务、完整skills/workflow/审批与权限反证、产物持久化恢复、至少10轮真人双向通话、自然停顿/打断/静音/断连重试、设备释放和两项P95均未完成。不得评分为9分或标交付。

DevApp没有部署本轮修复。本轮不改部署、不合并PR。协调登记按用户要求跳过。

## 复现探针

从仓库根运行：QWEN_ACCEPTANCE_ENV_FILE=/绝对路径/cn.local.env QWEN_ACCEPTANCE_OUT_DIR=/证据目录 node evidence/digital-acceptance-20261002/r1/text-to-audio-probe.cjs。
音频输入探针要求证据目录已有16k单声道PCM16的input-speech.pcm。运行同样环境参数下的audio-to-audio-probe.cjs。探针只记录事件类型/实际音频/脱敏供应商错误，输入/输出音频边界见JSON。

## 新浏览器回归发现
本地composition首次通话失败：WebSocketServer直接传递connection回调把HTTP request当成loopback observer，触发observer.clientEvent不是函数，测试栈崩溃。改为显式单参数适配socket，保留失败截图；修复后同用例复验。该故障仅属于测试runner，生产网关不走此回调。

复验于2026-10-03（Asia/Shanghai）：新的浏览器标签成功进入通话、静音与挂断恢复，local-composition-connected.jpg与local-composition-muted.jpg保存同用例结果。音量仍0、无识别内容；浏览器输入音频和持久化记录未通过，不可将连接恢复扩展为音频验收通过。API45/45、Web43/43、API/Web类型检查和lint全绿。
