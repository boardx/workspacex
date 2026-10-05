# 共识否定范围 #5301

真实公开合成报告中明确否定句被固定前16字窗口截断。仅针对同一句、同一共识谓词的否定范围识别，转折/分句不继承前面的否定；双重否定及“否认/否定/排除”不豁免证据要求。

TDD：原校验27项中新增反例8失败；修复后27/27通过。保留真正肯定共识的两个服务端专家引用要求，以及所有原精确quote/locator/version/hash/身份测试。模型输出原字节不改写。typecheck与完整真实模型集成验收另记，不用阶段结果代替完整报告成功。

Independent review caught object-scoped `断言` missing from the supported negative verbs. Added two regressions: `不应将单个角色的证言断言为跨角色共识。` and `不能将这些观点断言为跨角色共识。`; both failed before the fix. After adding this verb to the existing scoped object pattern, grounding 29/29 and recovery 19/19 passed on the updated main base. No blanket negation exemption was introduced.
