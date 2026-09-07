# Core preview CI boundary

At public 8cc4a46a0, pytest passed. Backend shard 4 failed because the newly added real document HTTP test required WX_NATIVE_SANDBOX_CONTAINER while ordinary shards provision only PostgreSQL. The other 227 files / 1664 cases in that shard passed.

The document test is moved to an explicit native-document configuration, preserving its mandatory container check. A dedicated backend-gates job builds and starts the real isolated session sandbox and PostgreSQL, runs the complete document/cached-source-revocation suite, and releases both. Deployment depends on this job; no skip substitutes for its result. The dedicated configuration passed all seven cases locally before the CI run.

Manual preview deployment is restricted to the already authorized codex/standard-capabilities branch, requires the full gates, and passes the immutable workflow SHA into the existing root-owned deploy wrapper. Main is not merged. Browser/native features remain configuration dependent; devapp smoke must establish which paths are actually enabled.
