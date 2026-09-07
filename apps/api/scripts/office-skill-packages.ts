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
Unsupported objects are listed in a structured OFFICE_EDIT_UNSUPPORTED_OBJECT error and the
output is not published. Unmodified ZIP entries retain their bytes. PptxGenJS creates presentations; it cannot import
and edit a presentation. XLSX editing uses ExcelJS and supports literal cells; complex
macros, signatures, unsupported drawings and other advanced features are not promised
lossless. The finite XLSX editor rejects macros, signatures, external links, pivots,
drawings and comments before writing. Formula recalculation on open is requested and
reported as requested_on_open_not_performed; no cached result is invented. PDF page selection is
structural copying, not body editing, secure redaction or guaranteed form preservation.
For a standard PDF AcroForm, the preinstalled pdf-lib can fill existing text fields
and checkboxes. Reopen the saved bytes and check field values; do not flatten before
that verification. This does not support XFA, encrypted forms, digital signatures or
arbitrary PDF body editing. Form handling is separate from the page-copy script.
Run scripts/render-office.py INPUT NEW_OUTPUT_DIRECTORY using python3 inside native execute.
It uses preinstalled LibreOffice/Poppler to create PDF and 96-DPI page PNGs offline.
Do not install tools at runtime. If a renderer is missing, stop and report unverified.
The manifest reports visualInspection=required: examine
each page/slide for clipping and CJK glyphs. If unavailable, state rendering unverified;
ZIP/XML checks are not visual QA. Never claim ready/rendered merely because bytes exist.
`;
const nativeGuide=(name:string)=>`## Execution protocol — choose the available runtime
When the caller supplies RUN_SCRIPT_PROTOCOL (the legacy call_skill path), follow
that supplied script-block protocol and use SKILL_SANDBOX_OUT_DIR from the original recipes below.
Return the executable script for the existing executor; do not call unavailable
native tools or assume /skills and /workspace are mounted. Do not claim a file has been executed, rendered or delivered from script text alone.
Only report renderer verification when actual execution results provide it.
If neither executable protocol nor native tools are available, explain that file
execution is unavailable rather than inventing a download.

## Native execution entrypoint
Only when native read_file, execute and wx_artifact_publish are actually available,
follow this section; it does not override the legacy script protocol above.
Read /skills/${name}/references/editing-and-qa.md before creating or editing files.
Write explicitly under /workspace. SKILL_SANDBOX_OUT_DIR and SKILL_SANDBOX_CJK_FONT
in the legacy examples below are not guaranteed native environment variables.
Do not repeatedly probe the environment or install packages. For embedded PDF CJK
text, the installed font is /usr/share/fonts/workspacex/NotoSansSC-Common.otf.
Render the ACTUAL source file with the existing helper:
python3 /skills/${name}/scripts/render-office.py /workspace/actual-file /workspace/preview
Replace actual-file with its real filename and extension; the preview directory must be new.
This helper supplies the offline LibreOffice path, font setup and restart handling.
Do not call an unconfigured soffice wrapper. Do not redraw a separate PDF and claim
it is a preview of the DOCX/XLSX/PPTX. Inspect every actual page PNG. Exit 0 still
requires visual inspection; a font warning alone is not a rendering failure.
Do not run npm/pip installs. Publish the verified actual source and previews with
wx_artifact_publish. Adapt legacy environment-variable examples to these native paths.

`;
export function officeSkillPackage(spec:{skillId:string;stableName:string;content:string}) {
 const resource=spec.stableName==='xlsx-create'?'edit-xlsx.cjs':spec.stableName==='pdf-create'?'pdf-pages.cjs':'edit-ooxml.py';
 const script=readFileSync(new URL(`./office-package-resources/${resource}`,import.meta.url),'utf8');
 const body=`---\nname: ${spec.stableName}\ndescription: Create Office files with preinstalled libraries and perform explicitly limited edits.\n---\n\n${nativeGuide(spec.stableName)}${spec.content}\n\n## 完整包附带工具\n参考 references/editing-and-qa.md；有限编辑脚本 scripts/${resource}。创建沿用上文预装库；原生 execute 已执行的代码不要再次交给旧脚本路径。\n`;
 const sources=[{path:'SKILL.md',content:body,mediaType:'text/markdown'},
 {path:'references/editing-and-qa.md',content:guide,mediaType:'text/markdown'},
 {path:`scripts/${resource}`,content:script,mediaType:resource.endsWith('.py')?'text/x-python':'text/javascript'},
 {path:'scripts/render-office.py',content:readFileSync(new URL('./office-package-resources/render-office.py',import.meta.url),'utf8'),mediaType:'text/x-python'}];
 const digest=hash(JSON.stringify(sources.map(f=>[f.path,hash(f.content)])));
 const files=sources.map(f=>({path:f.path,contentBase64:Buffer.from(f.content).toString('base64'),mediaType:f.mediaType,digest:hash(f.content)}));
 return {digest,package:C.TrustedSkillPackage.parse({skillId:spec.skillId,versionId:`${spec.skillId}-pkg-${digest}`,files})};
}
