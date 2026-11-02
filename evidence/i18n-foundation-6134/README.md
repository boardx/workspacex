# 国际化一期验证记录

基线 origin/develop 151526a4f；issue #6134。用户通过主会话明确“按计划直接开发”，本次按直接交办路径交付，不修改任何人类签核 status 或 feature passing。

- 隔离 worktree ./init.sh 快速路径退出0；pnpm harness readiness 已运行。tick 因未接线失败，未声称持有协调租约。
- 首次 i18n 行为测试红：缺少 @/lib/i18n/provider。实现后新增8项测试绿（i18n-tests.log）。修复过一条跨br文本查询，改为可访问heading查询。
- 原首页/菜单/认证/面板相关7个测试文件56项通过；该轮新测试的一条文本断言失败，随后修正重跑，不能将旧轮总结果当全绿。
- 真实Chromium读取 `/` 后进入 `/login`，切英文、表单邮箱保留、html lang更新、刷新保留、375/768/1280宽度无溢出、切回中文（browser.log）。实际HTTP页面，无认证/内容API mock。没有声称验收已登录真实组织首页的数据链路。
- 初轮完整web typecheck退出0、Next lint零警告；后续局部模板/状态及反馈文案修改会由最终检查再次覆盖。
- Homepage HomeConfig API内容（横幅、组织名称、推荐Agent/Skill名字/简介）保留源文本，后续数据库展示翻译独立处理。
- local版能力差异/出网契约及通知弹层的领域文案仍需二期按稳定id接入资源，不能将一期称为全站全量英文化。

独立复核修正：完整HomeConfigError闭集与HTTP兜底已改走统一资源，保持中文原语义，并补英文FILE_TOO_LARGE行为断言。计数支持按Intl.PluralRules选择`key.<category>`资源，缺相应变体使用基础模板；英文artifact已覆盖1/2的单复数，中文保持原句式。先见2条预期失败，再实现后6文件72项全绿（review-tests.log）。

移动入口补漏：补充mobile-tab-me英文断言后先见红，为稳定key `me`接入已有ui.me资源；10项语言测试通过（mobile-tests.log）。此补丁更新PR head，旧SHA的CI不代表补丁后状态。

CI纠正：verify-control-plane发现i18n-entry未进入任何CI配置（run41510103520/job125500218805）。已接入现有playwright.organization-create.config.ts testMatch，复用无条件CI命令和同一个公共入口devserver，无新增豁免。完整lint-spec-gate-coverage扫描通过，明确i18n-entry由该配置覆盖（spec-gate.log）；该注册配置真实运行1 passed（registered-browser.log）。首次本地冷启动120s超时、未执行断言，第二次相同配置缓存热后2.0m通过；没有放宽config.webServer时限。新增spec自身预算90s覆盖冷入口编译与完整语言往返检查。

原生review修正：discussion_r4446721932指出个人Radix菜单中原生select不在roving focus集合。改为MenuRadioGroup/MenuRadioItem，语言名称保持自称，沿用同一locale持久化。新增真实Radix组件键盘回归：从账单链接ArrowDown到中文，再ArrowDown到英文，Enter切换，html lang和cookie同步；旧实现找不到menuitemradio先红，修复后23项相关测试通过（keyboard-tests.log）。检查了全部reviewThreads，目前仅此一条待回复/resolve；最终head继续正常静态门与CI，不用旧head全绿代替。
