import {defineConfig} from 'vitest/config';
// Resolve contracts from this checkout even when dependencies are shared with another worktree.
export default defineConfig({resolve:{alias:[
 {find:/^@repo\/contracts\/(.*)$/,replacement:new URL('../../packages/contracts/src/$1.ts',import.meta.url).pathname},
 {find:'@repo/contracts',replacement:new URL('../../packages/contracts/src/index.ts',import.meta.url).pathname},
]},test:{include:process.env.WX_IMAGE_PYTHON?['tests/agent-runtime/qwen-image-pillow-live.test.ts']:['tests/agent-runtime/image-pricing-basis.test.ts','tests/agent-runtime/image-activation-pricing.test.ts','tests/agent-runtime/select-image-provider.test.ts','tests/agent-runtime/stage-two-image-admission.test.ts','tests/agent-runtime/stage-two-image-wiring.test.ts','tests/agent-runtime/local-edition-no-image-egress.test.ts','tests/agent-runtime/qwen-image-routing.test.ts','tests/agent-runtime/bailian-image-bounds.test.ts','tests/agent-runtime/standard-image-tools.test.ts'],maxWorkers:1,minWorkers:1}});
