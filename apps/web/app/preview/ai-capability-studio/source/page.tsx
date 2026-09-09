import { SourceBindingPreview } from "@/components/ai-capability-studio/source-binding-preview";
import { isSourcePreviewContext } from "@/components/ai-capability-studio/source-preview-navigation";
export default function SourceBindingPage({ searchParams = {} }: { searchParams?: { skillId?: string; draftId?: string } }) {
  if ((searchParams.skillId || searchParams.draftId) && !isSourcePreviewContext(searchParams)) return <main><h1>来源修复上下文不可用</h1><p>此预览只支持固定示例草稿，无法打开其他资源。</p></main>;
  return <SourceBindingPreview />;
}
