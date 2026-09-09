import { SourceConnectionsPreview } from "@/components/ai-capability-studio/source-connections-preview";
import { isSourcePreviewContext } from "@/components/ai-capability-studio/source-preview-navigation";
export default function SourceConnectionsPage({ searchParams = {} }: { searchParams?: { returnTo?: string; skillId?: string; draftId?: string } }) {
  if (searchParams.returnTo === "source" && !isSourcePreviewContext(searchParams)) return <main><h1>来源修复上下文不可用</h1><p>此预览只支持固定示例草稿，无法打开其他资源。</p></main>;
  return <SourceConnectionsPreview initialTarget={searchParams.returnTo === "source" ? "upstream" : "import"} />;
}
