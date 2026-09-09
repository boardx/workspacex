"use client";
import { useState } from "react";
import Link from "next/link";
import { SkillSourceAssessment, operations, skillAdaptationExchange } from "@repo/contracts/skill-source-assessment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const digest = "a".repeat(64);
const sourceFiles = [
  { path: "README.md", digest, sizeBytes: 100 },
  { path: "analyze.py", digest, sizeBytes: 100 },
];
const assessment = SkillSourceAssessment.parse({ assessmentId: "demo-adaptation", assessmentDigest: digest,
  pin: { source: { kind: "github", repositoryUrl: "https://github.com/example/python-research-tool", requestedRef: "main", resolvedCommit: "b".repeat(40), selection: "repository-root", path: null, authConnectionId: null }, sourceDigest: digest },
  expiresAt: "2026-09-11T00:00:00Z", compatibility: "needs-adaptation", inventory: { files: sourceFiles, license: { expression: null, path: null }, dependencies: ["Python运行环境需要另行确认"], scriptPaths: ["analyze.py"] }, missingRequirements: ["未提供SKILL.md", "缺少可复现的输入/输出与执行约束", "来源许可未识别，需确认使用与分发范围"] });

export function SourceAdaptationPreview() {
  const [selected, setSelected] = useState(["README.md"]);
  const [name, setName] = useState("research-adaptation");
  const [reviewed, setReviewed] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof operations.createSkillAdaptationDraft.out.parse> | null>(null);
  const [instructions, setInstructions] = useState("");
  const [savedInstructions, setSavedInstructions] = useState("");
  const [notice, setNotice] = useState("");
  const create = () => {
    if (!reviewed || !selected.length || assessment.compatibility !== "needs-adaptation") return;
    const parsed = operations.createSkillAdaptationDraft.in.safeParse({ assessmentId: assessment.assessmentId, expectedAssessmentDigest: assessment.assessmentDigest, name, selectedPaths: selected, idempotencyKey: "demo-adaptation-request" });
    if (!parsed.success) { setNotice("请填写有效草稿名称和所选文件。"); return; }
    const attachments = sourceFiles.filter(file => selected.includes(file.path)).map(file => ({ sourcePath: file.path, draftPath: `references/imported/${file.path}`, digest: file.digest }));
    const response = operations.createSkillAdaptationDraft.out.parse({ assessmentId: assessment.assessmentId, assessmentDigest: assessment.assessmentDigest, attachments, manifestProvenance: { kind: "generated-template", templateId: "skill-adaptation-v1", contentDigest: "c".repeat(64) }, remainingWork: ["补全生成的SKILL.md模板内容", ...assessment.missingRequirements.filter(item => item !== "未提供SKILL.md")],
      draft: { skillId: "demo-adapted-skill", draftId: "demo-adapted-draft", revision: 1, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest: "c".repeat(64), sizeBytes: 100 }, ...attachments.map(file => ({ path: file.draftPath, digest: file.digest, sizeBytes: 100 }))], sourcePin: assessment.pin, basedOnPublishedVersionId: null, updatedAt: "2026-09-10T00:00:00Z" } });
    skillAdaptationExchange.parse({ assessment, request: parsed.data, response });
    const initial = `---\nname: ${JSON.stringify(parsed.data.name)}\ndescription: 待完成的适配草稿\n---\n\n# 使用目标\n请补充适用场景、输入与输出。\n\n# 来源说明\n参考文件保存在 references/imported/，未执行来源脚本。\n\n# 执行约束\n确认运行环境、许可和工具权限后，再通过真实试跑验证。`;
    setInstructions(initial); setSavedInstructions(initial); setDraft(response); setNotice("已创建页面内适配草稿：保留来源，尚不可发布或运行。");
  };
  return <main className="min-h-screen bg-background p-6 text-background-foreground" data-testid="source-adaptation-preview"><div className="mx-auto max-w-4xl space-y-5">
    <Link href="/preview/ai-capability-studio/import" className="text-13 text-primary">返回导入向导示例</Link>
    <header><h1 className="text-28 font-semibold">把普通仓库适配为 Skill</h1><p className="mt-2 text-13 text-muted-foreground">独立演示场景 · 固定示例仓库，不读取前页输入，不联网、不执行源码、不创建真实草稿。</p></header>
    <section className="space-y-3 rounded-container border border-border bg-card p-5"><h2 className="text-16 font-semibold">预检结论：需适配，不能直接运行</h2><p className="break-all text-12">https://github.com/example/python-research-tool · main → {"b".repeat(12)}</p><p className="text-12">未找到 SKILL.md。来源许可未知；导入参考材料不表示已获再分发授权。脚本与依赖均需要人工审阅。</p>
      <label className="block text-12" htmlFor="adaptation-name">新草稿名称<Input id="adaptation-name" value={name} disabled={!!draft} onChange={event => { setName(event.target.value); setReviewed(false); }} /></label>
      <fieldset className="space-y-2"><legend className="mb-2 text-13">选择作为参考保留的源码</legend>{sourceFiles.map(file => <label key={file.path} className="flex gap-2 text-12"><input type="checkbox" checked={selected.includes(file.path)} disabled={!!draft} onChange={event => { setSelected(paths => event.target.checked ? [...paths, file.path] : paths.filter(path => path !== file.path)); setReviewed(false); }} />{file.path}{file.path.endsWith(".py") ? " · 脚本，仅作为参考保存，不执行" : " · 说明文档"}</label>)}</fieldset>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" data-testid="adaptation-review" checked={reviewed} disabled={!!draft} onChange={event => setReviewed(event.target.checked)} />我已检查所选参考文件；许可仍待核实，后续不会自动运行或交给AI读取。</label>
      <Button variant="primary" data-testid="adaptation-create" disabled={!!draft || !reviewed || !selected.length || !name.trim()} onClick={create}>创建演示适配草稿</Button>
    </section>
    {notice && <p role="status" className="text-13">{notice}</p>}
    {draft && <section className="space-y-3 rounded-container border border-border bg-card p-5" data-testid="adaptation-draft"><h2 className="text-16 font-semibold">继续开发 · 未发布</h2><ul className="space-y-1 text-12">{draft.draft.files.map(file => <li key={file.path}>{file.path}</li>)}</ul><label htmlFor="adaptation-instructions" className="block text-12">编辑 SKILL.md<Textarea id="adaptation-instructions" value={instructions} onChange={event => setInstructions(event.target.value)} rows={12} /></label><Button variant="outline" disabled={instructions === savedInstructions} onClick={() => { setSavedInstructions(instructions); setNotice("说明已保留在当前页面，尚未持久化；关闭页面会丢失。还需确认环境、许可和真实试跑。"); }}>保留本页修改</Button><ul className="list-inside list-disc text-12">{draft.remainingWork.map(work => <li key={work}>{work}</li>)}</ul><p className="text-12 text-muted-foreground">这页仅供审阅适配交互。生产持久化、多文件编辑、试跑和发布接线仍待实现，当前没有可运行版本。</p></section>}
  </div></main>;
}
