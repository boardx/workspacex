# Publisher lifecycle diagnostic and fixture cleanup

Refs #5785. Source48bd32561 changes only the extracted publisher lifecycle test. Original production2s grace, main5s observation, expected exit codes, owned-child death and unrelated-process survival assertions remain unchanged. Bounded stderr tracing records actual fixture stages; finally joins publisher and unrelated child before deleting the directory, retaining it if publisher closure cannot be confirmed. No production release code or timeout was changed.

Validation: original18/18 passed; complete root209files/2510tests passed(607.94s), TERM-resistant1351ms in full suite. Targeted strict TypeScript and unchanged OSSscan exit0. The prior formal billing run naturally failed the5s observation; this pass does not establish that failure's root cause. A future recurrence now carries stage timing and owned process-group state rather than a bare timeout.

No Docker/provider/release writes occurred in the lifecycle scenarios. All child processes and guards were cleaned.
