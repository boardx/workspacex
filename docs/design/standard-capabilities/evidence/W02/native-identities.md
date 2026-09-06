# Native tool identity verification

Native DeepAgents 0.7.6 filesystem/execute tools are checked against the actual compiled ToolNode, installed package version, and callable module/qualname. Trusted native run journal tool_start/tool_end events carry catalog provenance. Unknown and legacy tools do not receive native identities.

Evidence: 3 Python compiled graph tests, 3 contract tests, and 12 gateway/guard tests passed. Gateway tests use in-memory ports and exercise actual executeQueuedRuns journal projection; they are not database or real-model evidence. No claim of deployed availability.
