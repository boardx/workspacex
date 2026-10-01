# Chat 官方数字人导入组织隔离

统一 PR #4867 的继续修复，基于 9f3dca515。

调用链核实：CapabilityPicker 主入口和 CapabilityPopover 自带入口均调用同一个 useOfficialRoleOffer；这是唯一剩余未传 scope 的 chat enableOfficialRolePack 调用。现在复用已有 authenticated-session-scope revision 和 import helper 的组织/token/signal/isCurrent 参数，不新增组织权限判断或请求协议。

会话、组织或账号改变、选择器关闭与卸载均取消当前导入；每一步 POST 继续走已有 expectedOrgId 后端校验。旧 offer 在渲染时即隐藏；旧导入的进度、错误、结果与迟到目录刷新不得写回新上下文。同步 busy ref 防止同一渲染周期重复发起。

验证：新增 hook + 实际 helper 反证，原实现 6/6 失败；修复后 8 项通过，含真实 CapabilityPicker/portal 启用按钮、冻结 scope、org/token/关闭/卸载中断、旧 offer 与迟到目录读隔离。加原 helper 和能力 UI/模型回归共 46 项通过。见 chat-import-scope-counterproof.log 与 chat-import-scope-tests.log。

修改组件和新增测试的目标 ESLint 检查退出 0。此次按协调要求未启动全量 typecheck；根任务整合后执行统一检查。尚未部署，浏览器与真实数字人效果验收仍待完成。取消不回滚此前在原组织合法完成的导入。
