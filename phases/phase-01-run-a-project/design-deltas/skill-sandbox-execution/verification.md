# verification · 试跑接真执行

> 每条都要求**可执行、可复现**，且**每个门控配一条反证**——本仓已九次踩过"全绿但空转"。

## V1 端到端：真实模型 → 沙箱 → 真 .pptx

真栈 e2e：导入 pptx skill → 试跑 → 轮询到终态 → 下载产物。断言：
- 产物是合法 OOXML：zip 完整性 OK；`[Content_Types].xml` 含
  `presentationml.presentation.main+xml`；每个 `ppt/slides/slideN.xml` 能被 XML 解析。
- 幻灯片数量与请求一致；正文 `<a:t>` 文本非空。

⚠ **反证 V1-CP**：把沙箱执行结果替换成"返回空文件"，本条必须变红。
少了它，一个"总是回一个 0 字节文件"的实现会全绿。

## V2 隔离边界是活的（两条，各锁一层）

- **V2-a（L2 进程层）**：提交一个 `require('fs').writeFileSync('/etc/x')` 的脚本，
  必须以 `ERR_ACCESS_DENIED` 失败，且 `/etc/x` 不存在。
  同理再测 `child_process.execSync` 与越界读。
- **V2-b（L1 容器层，⚠ 最关键）**：提交一个 `fetch('http://<测试用回环地址>')` 的脚本，
  必须**失败**。
  ⚠⚠ 这一条**不能**只靠 Node 权限模型——实测（#1575 ⑤）它对网络是无效的。
  本条红/绿直接反映 `network: none` 是否真的生效。**任何让它转绿的"修法"若不是
  真的关掉网络，就是把门控调成不会红。**

⚠ **反证 V2-CP**：把容器的 `network: none` 摘掉，V2-b 必须立刻变红。
若摘掉后仍绿，说明这条断言测的不是网络。

## V3 重试循环真的在重试

注入一个"第一次必失败、第二次成功"的确定性替身，断言：
- 最终成功；
- 且**确实发生了 2 次执行**（不是第一次就蒙对）。

⚠ **反证 V3-CP**：把重试上限改成 1，本条必须变红。

## V4 三个新失败码各自可达且不串味

- `SANDBOX_UNAVAILABLE`：沙箱地址不可达 ⇒ 该码（**不是** `MODEL_UNAVAILABLE`）。
- `SANDBOX_TIMEOUT`：脚本死循环 ⇒ 该码，且容器被回收。
- `SCRIPT_FAILED_AFTER_RETRIES`：注入恒失败替身 ⇒ 该码，**且响应里带着最后一次
  真实 stderr**（断言 stderr 原文出现，不是"请重试"）。

⚠ **反证 V4-CP**：把三个码合并成一个通用失败码，本条必须变红。

## V5 洋葱依赖方向

`lint-arch-deps` 通过；且断言 `interface/` 下无任何文件直接 import
`infrastructure/**/http-skill-sandbox*`。

## V6 不回归

`skill-trial-run` 既有断言全绿（授权口径、既有错误码语义未变）。
