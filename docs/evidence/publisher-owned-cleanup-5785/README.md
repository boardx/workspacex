# Publisher lifecycle diagnostic and fixture cleanup

Refs #5785. Source48bd32561 changes only the extracted publisher lifecycle test. Original production2s grace, main5s observation, expected exit codes, owned-child death and unrelated-process survival assertions remain unchanged. Bounded stderr tracing records actual fixture stages; finally joins publisher and unrelated child before deleting the directory, retaining it if publisher closure cannot be confirmed. No production release code or timeout was changed.

Validation: original18/18 passed; complete root209files/2510tests passed(607.94s), TERM-resistant1351ms in full suite. Targeted strict TypeScript and unchanged OSSscan exit0. The prior formal billing run naturally failed the5s observation; this pass does not establish that failure's root cause. A future recurrence now carries stage timing and owned process-group state rather than a bare timeout.

No Docker/provider/release writes occurred in the lifecycle scenarios. All child processes and guards were cleaned.

Cross-platform follow-up sourced970acc809ef226bb20a93ad3e76f91a00c50eae: owned-dead assertions no longer treat missing procfs as success onmacOS. NonLinux kill0 recognizes onlyESRCH as dead (EPERM fails closed); Linux first proves procfs exists then retains nonliveZ/reaped checks. Before stopping nonEXIT fixtures both child PIDs must be alive. Original1s death budget unchanged. Fresh18/18 and root209/2510 passed(392.58s), targetedstrictTypeScript/OSS exit0; newlogs include command/source/exit receipts. Earlier48b logs remain historical evidence, not substituted for this version.
