#!/usr/bin/env node
// This installed entry deliberately has no production recovery/writer adapter.
// Never route a maintenance request through normal provision as a fallback.
console.error("CN_MAINTENANCE_BLOCKED:PRODUCTION_THREE_DATABASE_RECOVERY_ADAPTER_NOT_IMPLEMENTED");
process.exitCode = 1;
