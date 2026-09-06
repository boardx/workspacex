import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { standardCapabilities as C } from "@repo/contracts";
const hash=(content:string)=>createHash('sha256').update(content).digest('hex');
const guide=`# Supported editing and verification
These packages reuse the existing Node creation recipes. Do not install dependencies.
Use native execute for scripts and /workspace for inputs/outputs; never execute a fenced
script a second time after it has already run. Inspect and render before delivery.
Word/PPT edits only replace one entire exact text node in the specified XML part; split
runs, ambiguous text, layout reconstruction and arbitrary embedded objects are unsupported.
Unmodified ZIP entries retain their bytes. PptxGenJS creates presentations; it cannot import
and edit a presentation. XLSX editing uses ExcelJS and supports literal cells; complex
macros, signatures, unsupported drawings and other advanced features are not promised
lossless. Recalculation on open is requested, not performed here. PDF page selection is
structural copying, not body editing, secure redaction or guaranteed form preservation.
Render QA is a separate required step: use an available real Office/PDF renderer, examine
each page/slide for clipping and CJK glyphs. If unavailable, state rendering unverified;
ZIP/XML checks are not visual QA. Never claim ready/rendered merely because bytes exist.
`;
export function officeSkillPackage(spec:{skillId:string;stableName:string;content:string}) {
 const resource=spec.stableName==='xlsx-create'?'edit-xlsx.cjs':spec.stableName==='pdf-create'?'pdf-pages.cjs':'edit-ooxml.py';
 const script=readFileSync(new URL(`./office-package-resources/${resource}`,import.meta.url),'utf8');
 const body=`---\nname: ${spec.stableName}\ndescription: Create Office files with preinstalled libraries and perform explicitly limited edits.\n---\n\n${spec.content}\n\n## 完整包附带工具\n参考 references/editing-and-qa.md；有限编辑脚本 scripts/${resource}。创建沿用上文预装库；原生 execute 已执行的代码不要再次交给旧脚本路径。\n`;
 const sources=[{path:'SKILL.md',content:body,mediaType:'text/markdown'},
 {path:'references/editing-and-qa.md',content:guide,mediaType:'text/markdown'},
 {path:`scripts/${resource}`,content:script,mediaType:resource.endsWith('.py')?'text/x-python':'text/javascript'}];
 const digest=hash(JSON.stringify(sources.map(f=>[f.path,hash(f.content)])));
 const files=sources.map(f=>({path:f.path,contentBase64:Buffer.from(f.content).toString('base64'),mediaType:f.mediaType,digest:hash(f.content)}));
 return {digest,package:C.TrustedSkillPackage.parse({skillId:spec.skillId,versionId:`${spec.skillId}-pkg-${digest}`,files})};
}
