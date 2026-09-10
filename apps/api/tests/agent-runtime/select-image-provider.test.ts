/**
 * 供应商选择的三条规则（见 `select-image-provider.ts` 头注）。
 *
 * 最要紧的是**第 1 条的反面**：显式点名了一家、那家没配 key ⇒ 返回 `null`，**不偷偷
 * 回落到另一家**。人明确要 OpenAI 却在跑百炼，比「图像功能没上」难查得多——回执里的
 * `modelRef` 会是 `wanx2.1-t2i-plus`，而没人会去看回执，直到某天有人问"为什么中文
 * 还是糊的"。
 */
import {expect,it} from 'vitest';
import {selectImageProvider} from '../../src/infrastructure/agent-run/select-image-provider';
const env=(o:Record<string,string>)=>o as unknown as NodeJS.ProcessEnv;

it('uses bailian when only bailian is configured — the behaviour before OpenAI existed, unchanged',()=>{
 const s=selectImageProvider(env({KERNEL_MODEL_API_KEY:'dashscope-key'}));
 expect(s?.choice).toBe('bailian');expect(s?.provider.modelRef).toBe('wanx2.1-t2i-plus');
});

it('uses openai when only openai is configured — no switch needed, so the capability cannot silently vanish',()=>{
 const s=selectImageProvider(env({OPENAI_API_KEY:'sk-test'}));
 expect(s?.choice).toBe('openai');expect(s?.provider.modelRef).toBe('gpt-image-1');
});

it('prefers bailian when both are configured and nothing was requested — the pre-existing default wins',()=>{
 expect(selectImageProvider(env({KERNEL_MODEL_API_KEY:'d',OPENAI_API_KEY:'o'}))?.choice).toBe('bailian');
});

it('honours an explicit request over the default',()=>{
 expect(selectImageProvider(env({KERNEL_MODEL_API_KEY:'d',OPENAI_API_KEY:'o',KERNEL_IMAGE_PROVIDER:'openai'}))?.choice).toBe('openai');
 expect(selectImageProvider(env({KERNEL_MODEL_API_KEY:'d',OPENAI_API_KEY:'o',KERNEL_IMAGE_PROVIDER:'BAILIAN'}))?.choice).toBe('bailian');
});

it('returns null — never the other vendor — when the explicitly requested one has no key',()=>{
 expect(selectImageProvider(env({KERNEL_MODEL_API_KEY:'d',KERNEL_IMAGE_PROVIDER:'openai'}))).toBeNull();
 expect(selectImageProvider(env({OPENAI_API_KEY:'o',KERNEL_IMAGE_PROVIDER:'bailian'}))).toBeNull();
});

it('returns null when neither vendor is configured',()=>{
 expect(selectImageProvider(env({}))).toBeNull();
 expect(selectImageProvider(env({KERNEL_MODEL_API_KEY:'   ',OPENAI_API_KEY:'  '}))).toBeNull();
});
