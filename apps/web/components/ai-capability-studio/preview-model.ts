/** Local preview state only. Production DTOs will come from the reviewed contracts. */
export type StudioFile = { path: string; content: string };
export type StudioTrial = { revision: number; dependencyRevision: number; passed: boolean };
export type StudioRelease = { number: number; revision: number; files: StudioFile[] };
export type StudioPreview = {
  files: StudioFile[]; selected: string; revision: number; dirty: boolean;
  dependencyRevision: number; modelEnabled: boolean; toolGranted: boolean;
  trial: StudioTrial | null; releases: StudioRelease[]; boundRelease: number | null;
};
export const demoFiles: StudioFile[] = [
  { path: "SKILL.md", content: "---\nname: research-brief\ndescription: 将资料整理为有来源的研究简报\n---\n\n# 研究简报\n\n1. 阅读用户提供的资料。\n2. 使用 scripts/build_brief.py 整理结论。\n3. 区分事实与推断，并保留来源。\n4. 输出可下载的 Markdown 简报。\n" },
  { path: "scripts/build_brief.py", content: "from pathlib import Path\n\ndef build_brief(title, facts):\n    body = '\\n'.join(f'- {fact}' for fact in facts)\n    Path('brief.md').write_text(f'# {title}\\n\\n{body}', encoding='utf-8')\n" },
  { path: "references/style.md", content: "# 写作约定\n\n使用简洁中文。每条事实附来源；信息不足时明确说明。\n" },
  { path: "examples/input.json", content: '{\n  "topic": "团队协作工具研究",\n  "sources": ["用户上传的访谈记录"]\n}\n' },
  { path: "tests/acceptance.md", content: "- 输出包含标题、主要发现、来源。\n- 无来源的信息不得写成事实。\n- 生成 brief.md，编码 UTF-8。\n" },
  { path: "LICENSE", content: "演示数据：导入时显示来源项目的原始许可证。\n" },
];
export function initialStudioPreview(): StudioPreview {
  const files = demoFiles.map(file => ({ ...file }));
  return { files, selected: "SKILL.md", revision: 3, dirty: false, dependencyRevision: 1,
    modelEnabled: true, toolGranted: true, trial: null,
    releases: [{ number: 1, revision: 2, files: files.map(file => ({ ...file })) }], boundRelease: 1 };
}
export function trialIsCurrent(s: StudioPreview): boolean {
  return !s.dirty && s.trial?.passed === true && s.trial.revision === s.revision &&
    s.trial.dependencyRevision === s.dependencyRevision && s.modelEnabled && s.toolGranted;
}
export function validPreviewPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some(part => part === ".." || part === "." || part === "") &&
    !/[\u0000-\u001f]/.test(path);
}
export type StudioAction =
  | { type: "select"; path: string } | { type: "edit"; content: string }
  | { type: "create"; path: string } | { type: "delete" } | { type: "rename"; path: string }
  | { type: "save" } | { type: "trial"; passed: boolean } | { type: "publish" }
  | { type: "bind"; release: number } | { type: "model" } | { type: "tool" }
  | { type: "ai-instructions" } | { type: "import" } | { type: "upstream" } | { type: "rollback"; release: number };
export function studioReducer(s: StudioPreview, a: StudioAction): StudioPreview {
  switch (a.type) {
    case "select": return s.files.some(f => f.path === a.path) ? { ...s, selected: a.path } : s;
    case "edit": return { ...s, dirty: true, files: s.files.map(f => f.path === s.selected ? { ...f, content: a.content } : f) };
    case "create": return !validPreviewPath(a.path) || s.files.some(f => f.path === a.path) ? s :
      { ...s, selected: a.path, dirty: true, files: [...s.files, { path: a.path, content: "" }] };
    case "rename": return s.selected === "SKILL.md" || !validPreviewPath(a.path) || s.files.some(f => f.path === a.path) ? s :
      { ...s, selected: a.path, dirty: true, files: s.files.map(f => f.path === s.selected ? { ...f, path: a.path } : f) };
    case "delete": return s.selected === "SKILL.md" ? s : { ...s, selected: "SKILL.md", dirty: true, files: s.files.filter(f => f.path !== s.selected) };
    case "save": return s.dirty ? { ...s, revision: s.revision + 1, dirty: false } : s;
    case "trial": return s.dirty || !s.modelEnabled || !s.toolGranted ? s :
      { ...s, trial: { revision: s.revision, dependencyRevision: s.dependencyRevision, passed: a.passed } };
    case "publish": return !trialIsCurrent(s) || s.releases.at(-1)?.revision === s.revision ? s : { ...s, releases: [...s.releases,
      { number: s.releases.length + 1, revision: s.revision, files: s.files.map(f => ({ ...f })) }] };
    case "bind": return s.releases.some(r => r.number === a.release) ? { ...s, boundRelease: a.release } : s;
    case "model": return { ...s, modelEnabled: !s.modelEnabled, dependencyRevision: s.dependencyRevision + 1 };
    case "tool": return { ...s, toolGranted: !s.toolGranted, dependencyRevision: s.dependencyRevision + 1 };
    case "ai-instructions": return { ...s, dirty: true, selected: "SKILL.md", files: s.files.map(f => f.path === "SKILL.md" ? { ...f, content: `${f.content}\n输出前逐条核对来源；信息不足时明确列出限制。\n` } : f) };
    case "import": return { ...s, files: demoFiles.map(f => ({ ...f })), selected: "SKILL.md", revision: s.revision + 1, dirty: false, trial: null };
    case "upstream": return { ...s, dirty: true, selected: "SKILL.md", files: s.files.map(f => f.path === "SKILL.md" ? { ...f, content: `${f.content}\n5. 新增上游要求：输出研究限制。\n` } : f) };
    case "rollback": {
      const release = s.releases.find(r => r.number === a.release);
      return release ? { ...s, dirty: true, files: release.files.map(f => ({ ...f })), selected: "SKILL.md" } : s;
    }
  }
}
