"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  discoverSkillsFromUrl,
  importSkillFromUrl,
  type DiscoverSkillsFromUrlOut,
} from "@/lib/live-skill-admin";

/**
 * #881 F2 —— 从 URL 导入 skill 的界面入口。
 *
 * 后端 `POST /admin/skills/url-imports`（#595）**早就接好了**，但 `apps/web` 里一直
 * 零调用 ⇒ 用户在后台只能看到「导入 starter pack」，导不了任意 URL。
 * 与 `SkillStarterImportPanel` 并列，形状刻意保持一致（同一个心智：填参数 → 确认 → 如实报结果）。
 *
 * ## `idempotencyKey` 为什么由前端持有、且只在入参变化时重置
 *
 * 与 starter pack 面板逐字同一条纪律：同一个 key 重放 ⇒ 服务端回 `replayed: true`
 * 且**不重复落库**。若每次点击都换一个新 key，"点两次导入两份"就回来了。
 * ⛔ 因此不要把它挪进 `lib/live-skill-admin.ts` 里随机生成——那等于把幂等性关掉。
 *
 * ## 不在这里复述权限规则
 *
 * 非管理员由服务端拒（`import-skill-from-url.ts` 的 admin 判定是**第一动作**，
 * 且在 fetch 之前——否则非管理员能让服务端替他发出站请求，成了 SSRF 探测器）。
 * 这一层只把失败原样显示出来。
 *
 * ## #1865 —— 「仓库/目录 URL」模式为什么是同一张卡片里的**第二个 tab**，不是新面板
 *
 * 真实世界的开源 skill 包（`anthropics/skills` 那种一个仓库多个 skill 子目录）
 * 用单文件模式导不出完整包——用户得先知道每个子目录的确切 URL。这个 tab 复用
 * 同一套幂等/失败展示纪律：扫描只读、不落库；**确认导入某个候选**时，直接把
 * 它的 `treeUrl` 当 `sourceUrl` 再打一次**既有的** `importSkillFromUrl`——
 * 落库、幂等 key、名字冲突、发布触发器等既有纪律原样复用，不重新发明。
 */
type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | {
      readonly status: "success";
      readonly skillId: string;
      readonly fileCount: number;
      readonly replayed: boolean;
      readonly refreshError?: string;
    }
  | { readonly status: "error"; readonly message: string };

type ImportMode = "single" | "repo";

function reasonCodeOf(failure: unknown): string {
  return failure instanceof ApiError
    ? `${failure.reasonCode ?? failure.message}`
    : failure instanceof Error
      ? failure.message
      : String(failure);
}

export function SkillUrlImportPanel({ onImported }: { onImported(): Promise<boolean> }) {
  /**
   * #1941 —— 默认展开，不是默认收起。
   *
   * 之前默认 `false`：第一次用的人得先点开一个折叠触发按钮才看得到"单文件/仓库导入"
   * 两个 tab 和输入框，实测（2026-08-23）时这个折叠面板一度把评测者导向"构建缓存坏了"
   * 的错误排查方向。这是个填空场景，展开不占用多少空间，没有理由默认藏起来——
   * 折叠触发按钮仍然保留（点一下可以收起，节省屏幕空间），只是初始态改了。
   */
  const [open, setOpen] = React.useState(true);
  const [mode, setMode] = React.useState<ImportMode>("single");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ResultState>({ status: "idle" });
  const active = React.useRef(true);
  const requestGeneration = React.useRef(0);

  React.useEffect(() => () => {
    active.current = false;
    requestGeneration.current += 1;
  }, []);

  /** 改了入参就换一次导入——旧 key 属于旧参数，复用它会把新参数的导入当成重放。 */
  const changeField = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setIdempotencyKey(null);
    setResult({ status: "idle" });
  };

  const submit = async () => {
    const trimmedUrl = sourceUrl.trim();
    const trimmedName = name.trim();
    if (!trimmedUrl || !trimmedName) return;
    const requestKey = idempotencyKey ?? window.crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    const request = ++requestGeneration.current;
    setResult({ status: "submitting" });
    let imported;
    try {
      imported = await importSkillFromUrl({
        sourceUrl: trimmedUrl,
        name: trimmedName,
        idempotencyKey: requestKey,
      });
    } catch (failure) {
      if (!active.current || request !== requestGeneration.current) return;
      /**
       * ⚠ 如实显示服务端的 reasonCode，**不翻译成"导入失败，请重试"**。
       * `IMPORT_URL_NOT_ALLOWED`（SSRF 门）与 `IMPORT_NAME_CONFLICT`（重名）
       * 要用户做的事完全不同，糊成一句话等于把两种失败都变成不可行动的。
       */
      setResult({ status: "error", message: reasonCodeOf(failure) });
      return;
    }
    if (!active.current || request !== requestGeneration.current) return;

    // 导入成功后刷新目录列表；刷新失败**不**冒充导入失败，两件事分开报。
    let refreshError: string | undefined;
    try {
      const refreshed = await onImported();
      if (!refreshed) refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
    } catch {
      refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
    }
    if (!active.current || request !== requestGeneration.current) return;
    setResult({
      status: "success",
      skillId: imported.skillId,
      fileCount: imported.filePaths.length,
      replayed: imported.replayed,
      ...(refreshError === undefined ? {} : { refreshError }),
    });
  };

  const submitting = result.status === "submitting";
  const canSubmit = sourceUrl.trim() !== "" && name.trim() !== "" && !submitting;

  return (
    <Card data-testid="skill-url-import-panel">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-13">从 URL 导入 Skill</CardTitle>
            <CardDescription className="text-11">
              服务端会抓取该地址并落成一个新 skill 版本；出站地址受 SSRF 门限制，失败会如实告诉你原因。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="skill-url-import-open"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Link2 aria-hidden className="h-3.5 w-3.5" />
            从 URL 导入
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="flex items-center gap-1" role="tablist" aria-label="导入模式">
            <Button
              size="sm"
              variant={mode === "single" ? "primary" : "outline"}
              data-testid="skill-url-import-mode-single"
              aria-pressed={mode === "single"}
              onClick={() => setMode("single")}
            >
              单文件 URL
            </Button>
            <Button
              size="sm"
              variant={mode === "repo" ? "primary" : "outline"}
              data-testid="skill-url-import-mode-repo"
              aria-pressed={mode === "repo"}
              onClick={() => setMode("repo")}
            >
              仓库/目录 URL
            </Button>
          </div>

          {mode === "single" ? (
            <div className="flex flex-col gap-2">
              <label className="text-10 text-muted-foreground" htmlFor="skill-url-import-url">
                来源 URL（https）
              </label>
              <Input
                id="skill-url-import-url"
                data-testid="skill-url-import-url"
                value={sourceUrl}
                placeholder="https://example.com/some-skill"
                onChange={(e) => changeField(setSourceUrl, e.target.value)}
              />
              <label className="text-10 text-muted-foreground" htmlFor="skill-url-import-name">
                导入后的显示名
              </label>
              <Input
                id="skill-url-import-name"
                data-testid="skill-url-import-name"
                value={name}
                onChange={(e) => changeField(setName, e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  data-testid="skill-url-import-confirm"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  {submitting ? "导入中…" : "确认导入"}
                </Button>
              </div>
              {result.status === "success" ? (
                <p data-testid="skill-url-import-result" className="text-12 text-success">
                  {/* `replayed` 是服务端说的，不是这里猜的——重放与新导入必须让用户看得出区别。 */}
                  {result.replayed
                    ? `这次是重放：该 idempotencyKey 之前已导入过，未重复落库（${result.skillId}）`
                    : `已导入 ${result.fileCount} 个文件（${result.skillId}）`}
                  {result.refreshError ? `　${result.refreshError}` : ""}
                </p>
              ) : null}
              {result.status === "error" ? (
                <p data-testid="skill-url-import-result" className="text-12 text-destructive">
                  导入失败：{result.message}
                </p>
              ) : null}
            </div>
          ) : (
            <SkillRepoDiscoveryPanel onImported={onImported} />
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

type ScanState =
  | { readonly status: "idle" }
  | { readonly status: "scanning" }
  | { readonly status: "found"; readonly skills: DiscoverSkillsFromUrlOut["skills"] }
  | { readonly status: "error"; readonly message: string };

type CandidateResult =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | {
      readonly status: "success";
      readonly skillId: string;
      readonly fileCount: number;
      readonly replayed: boolean;
      readonly refreshError?: string;
    }
  | { readonly status: "error"; readonly message: string };

/**
 * 一次扫描发现 N 个候选 skill 后，**逐个**确认要不要导入——粒度是"每个 skill"，
 * 不是"每个文件"（那些文件已经打包在候选自己的 `treeUrl` 里，用户看不到也不用管）。
 * ⛔ 扫描到就自动全部导入：那会让用户在没看清楚之前就把一整个仓库的东西都建成
 *   skill，与"逐个确认"的要求正相反。
 */
function SkillRepoDiscoveryPanel({ onImported }: { onImported(): Promise<boolean> }) {
  const [repoUrl, setRepoUrl] = React.useState("");
  const [scan, setScan] = React.useState<ScanState>({ status: "idle" });
  const active = React.useRef(true);
  React.useEffect(() => () => {
    active.current = false;
  }, []);

  const scanning = scan.status === "scanning";

  const runScan = async () => {
    const trimmed = repoUrl.trim();
    if (!trimmed) return;
    setScan({ status: "scanning" });
    try {
      const found = await discoverSkillsFromUrl({ sourceUrl: trimmed });
      if (!active.current) return;
      setScan({ status: "found", skills: found.skills });
    } catch (failure) {
      if (!active.current) return;
      setScan({ status: "error", message: reasonCodeOf(failure) });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-10 text-muted-foreground" htmlFor="skill-repo-import-url">
        仓库或目录 URL（https://github.com/&lt;owner&gt;/&lt;repo&gt;[/tree/&lt;branch&gt;[/&lt;path&gt;]]）
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="skill-repo-import-url"
          data-testid="skill-repo-import-url"
          value={repoUrl}
          placeholder="https://github.com/anthropics/skills/tree/main/skills"
          onChange={(e) => {
            setRepoUrl(e.target.value);
            setScan({ status: "idle" });
          }}
        />
        <Button
          size="sm"
          data-testid="skill-repo-import-scan"
          disabled={repoUrl.trim() === "" || scanning}
          onClick={() => void runScan()}
        >
          {scanning ? "扫描中…" : "扫描"}
        </Button>
      </div>
      {scan.status === "error" ? (
        <p data-testid="skill-repo-import-scan-result" className="text-12 text-destructive">
          扫描失败：{scan.message}
        </p>
      ) : null}
      {scan.status === "found" ? (
        <>
          <p data-testid="skill-repo-import-scan-result" className="text-12 text-muted-foreground">
            发现了 {scan.skills.length} 个 skill，逐个确认要不要导入。
          </p>
          <ul className="flex flex-col gap-2">
            {scan.skills.map((candidate) => (
              <SkillCandidateRow
                key={candidate.dirPath}
                candidate={candidate}
                onImported={onImported}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SkillCandidateRow({
  candidate,
  onImported,
}: {
  candidate: DiscoverSkillsFromUrlOut["skills"][number];
  onImported(): Promise<boolean>;
}) {
  const [name, setName] = React.useState(candidate.name);
  const [idempotencyKey, setIdempotencyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CandidateResult>({ status: "idle" });
  const active = React.useRef(true);
  React.useEffect(() => () => {
    active.current = false;
  }, []);

  const submitting = result.status === "submitting";

  const confirmImport = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    const requestKey = idempotencyKey ?? window.crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    setResult({ status: "submitting" });
    try {
      const imported = await importSkillFromUrl({
        sourceUrl: candidate.treeUrl,
        name: trimmedName,
        idempotencyKey: requestKey,
      });
      if (!active.current) return;
      let refreshError: string | undefined;
      try {
        const refreshed = await onImported();
        if (!refreshed) refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
      } catch {
        refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
      }
      if (!active.current) return;
      setResult({
        status: "success",
        skillId: imported.skillId,
        fileCount: imported.filePaths.length,
        replayed: imported.replayed,
        ...(refreshError === undefined ? {} : { refreshError }),
      });
    } catch (failure) {
      if (!active.current) return;
      setResult({ status: "error", message: reasonCodeOf(failure) });
    }
  };

  return (
    <li
      data-testid={`skill-repo-import-candidate-${candidate.dirPath}`}
      className="flex flex-col gap-1 rounded-md border border-border p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-12 font-medium">{candidate.dirPath}</span>
          {candidate.description ? (
            <span className="text-10 text-muted-foreground">{candidate.description}</span>
          ) : null}
          <span className="text-10 text-muted-foreground">约 {candidate.fileCount} 个文件</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          data-testid={`skill-repo-import-candidate-name-${candidate.dirPath}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setIdempotencyKey(null);
            setResult({ status: "idle" });
          }}
        />
        <Button
          size="sm"
          data-testid={`skill-repo-import-candidate-confirm-${candidate.dirPath}`}
          disabled={name.trim() === "" || submitting || result.status === "success"}
          onClick={() => void confirmImport()}
        >
          {submitting ? "导入中…" : result.status === "success" ? "已导入" : "导入"}
        </Button>
      </div>
      {result.status === "success" ? (
        <p
          data-testid={`skill-repo-import-candidate-result-${candidate.dirPath}`}
          className="text-11 text-success"
        >
          {result.replayed
            ? `这次是重放：未重复落库（${result.skillId}）`
            : `已导入 ${result.fileCount} 个文件（${result.skillId}）`}
          {result.refreshError ? `　${result.refreshError}` : ""}
        </p>
      ) : null}
      {result.status === "error" ? (
        <p
          data-testid={`skill-repo-import-candidate-result-${candidate.dirPath}`}
          className="text-11 text-destructive"
        >
          导入失败：{result.message}
        </p>
      ) : null}
    </li>
  );
}
