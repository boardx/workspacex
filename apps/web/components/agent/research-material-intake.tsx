"use client";

/**
 * 材料录入 —— 粘贴 / 上传 / URL 三条入口，把材料登记进研判会话。
 *
 * ## 本组件的全部设计目标：**不承诺做不到的事**（评分卡 U4）
 *
 * 材料录入最容易犯的错不是功能缺失，是**在上传之后才说不行**。用户选了一个 m4a
 * 录音，等了十秒，然后看到一句 `FILE_TYPE_REJECTED`。这一次失败的代价不只是重来，
 * 还有"这东西到底支持什么我也不知道"的不信任。
 *
 * 所以这里做三件事：
 * 1. `accept` 与拒绝判据**同一个来源**（`ATTACHMENT_MIME_ALLOWLIST`），文件选择器
 *    一开始就只让选得中的类型——而不是让人选完再拒。
 * 2. 不支持的类型**在选择那一刻**就逐个点名说清，连同"为什么"。
 * 3. 明说 Agent **不会自己上网找材料**。活动图里有"按自搜提示检索"这条箭头，
 *    而它没有实现。不说的话，用户会以为给个关键词它就会去搜——
 *    一个静默不做的承诺，比明说不做更伤。
 *
 * ## 录音为什么只收 wav / mp3
 *
 * 白名单里有 `audio/wav` 与 `audio/mpeg`，**没有 m4a**（iPhone 默认录音格式）。
 * 界面直说这件事，而不是写一个 `audio/*` 的 accept 去收一个必被拒的文件——
 * 那正是 team2 犯过并已修的错。
 */
import * as React from "react";
import { AlertCircle, Link2, Upload } from "lucide-react";
import { chatFileUpload as U, researchWorkflow as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import {
  addResearchMaterials,
  explainResearchFailure,
  type ResearchSession,
} from "@/lib/live-research-workflow";

/** `accept` 直接由白名单渲染——写死一串扩展名就是白名单的第二份声明。 */
const ACCEPT = U.ATTACHMENT_MIME_ALLOWLIST.join(",");

/** 人看得懂的支持清单。**从白名单派生**，不是手抄。 */
const SUPPORTED_HINT = "PDF、Word、Excel、PPT、txt/markdown/csv、PNG/JPG/WebP、录音仅 WAV / MP3";

export interface IntakeResult {
  accepted: File[];
  /** 逐个点名，连同原因——只说"有文件被拒"等于没说。 */
  rejected: { name: string; why: string }[];
}

/**
 * 客户端预检。**与服务端同一份白名单与上限**，所以这里说"收得下"的，服务端也收得下。
 *
 * 它不是权威（服务端仍会自行核验字节，防伪造 MIME），但它让"做不到"这件事
 * 在**用户还没等待**的时候就说清楚。
 */
export function intakeFiles(files: readonly File[]): IntakeResult {
  const accepted: File[] = [];
  const rejected: { name: string; why: string }[] = [];
  for (const f of files) {
    if (!(U.ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(f.type)) {
      // m4a 是最常撞上的那个（iPhone 默认录音格式），单独说清楚而不是一句"格式不支持"
      const why = /\.m4a$/i.test(f.name)
        ? "m4a 录音暂不支持，请转成 WAV 或 MP3"
        : `不支持的格式（${f.type || "未知类型"}）`;
      rejected.push({ name: f.name, why });
      continue;
    }
    if (f.size > U.ATTACHMENT_LIMITS.maxBytesPerFile) {
      const mb = Math.round(U.ATTACHMENT_LIMITS.maxBytesPerFile / 1024 / 1024);
      rejected.push({ name: f.name, why: `超过单文件 ${mb} MB 上限` });
      continue;
    }
    accepted.push(f);
  }
  if (accepted.length > U.ATTACHMENT_LIMITS.maxAttachmentsPerMessage) {
    const extra = accepted.splice(U.ATTACHMENT_LIMITS.maxAttachmentsPerMessage);
    for (const f of extra) {
      rejected.push({ name: f.name, why: `一次最多 ${U.ATTACHMENT_LIMITS.maxAttachmentsPerMessage} 个文件` });
    }
  }
  return { accepted, rejected };
}

/** URL 预检：只收 http(s)。给一个 `javascript:` 或裸域名都要当场说清。 */
export function checkUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  const t = raw.trim();
  if (t === "") return { ok: false, why: "还没填链接" };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, why: "这不是一个完整链接，要带 https://" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, why: "只支持 http / https 链接" };
  }
  return { ok: true, url: u.toString() };
}

export function ResearchMaterialIntake({
  session,
  onChange,
}: {
  session: ResearchSession;
  onChange: (next: ResearchSession) => void;
}): JSX.Element | null {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<{ what: string; next: string } | null>(null);
  const [rejected, setRejected] = React.useState<{ name: string; why: string }[]>([]);
  const [url, setUrl] = React.useState("");
  const [urlWhy, setUrlWhy] = React.useState<string | null>(null);

  // 材料只在还能收的阶段录入。已进入图谱生成之后再加材料，会让血缘对不上——
  // 那批材料没经过门①，却混进了结论的依据里。
  const canIntake = ["empty", "collecting", "materials_review"].includes(session.phase);
  if (!canIntake) return null;

  async function add(items: { source: "upload" | "url" | "paste"; label: string }[]) {
    if (items.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      onChange(await addResearchMaterials(session.threadId, items));
    } catch (e) {
      setFailure(explainResearchFailure(e));
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    const result = intakeFiles(picked);
    setRejected(result.rejected);
    void add(result.accepted.map((f) => ({ source: "upload" as const, label: f.name })));
    e.target.value = "";
  }

  function onAddUrl() {
    const r = checkUrl(url);
    if (!r.ok) {
      setUrlWhy(r.why);
      return;
    }
    setUrlWhy(null);
    setUrl("");
    void add([{ source: "url", label: r.url }]);
  }

  return (
    <section data-testid="research-intake" className="border-b border-border px-5 py-4 md:px-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-3">
        <header className="space-y-1">
          <h2 className="text-12 font-semibold">添加材料</h2>
          <p data-testid="research-intake-supported" className="text-11 text-muted-foreground">
            支持：{SUPPORTED_HINT}
          </p>
          {/* 活动图里有「按自搜提示检索」这条箭头，而它没有实现。
              不说的话，用户会以为给个关键词它就会去搜——静默不做的承诺比明说不做更伤。 */}
          <p data-testid="research-intake-no-autosearch" className="text-11 text-muted-foreground">
            ⚠ Agent 不会自己上网找材料，只分析你给的这些。
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex">
            <input
              data-testid="research-intake-file"
              type="file"
              multiple
              // accept 与拒绝判据同一个来源：让人一开始就只选得中收得下的类型，
              // 而不是选完再拒。
              accept={ACCEPT}
              onChange={onPick}
              disabled={busy}
              className="hidden"
            />
            <Button asChild variant="outline" size="sm" disabled={busy}>
              <span>
                <Upload aria-hidden className="size-3" />
                上传文件
              </span>
            </Button>
          </label>

          <input
            data-testid="research-intake-url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlWhy(null); }}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-11"
          />
          <Button data-testid="research-intake-url-add" variant="outline" size="sm" disabled={busy} onClick={onAddUrl}>
            <Link2 aria-hidden className="size-3" />
            加入链接
          </Button>
        </div>

        {urlWhy ? (
          <p data-testid="research-intake-url-why" className="text-11 text-destructive">{urlWhy}</p>
        ) : null}

        {/* 被拒的文件**逐个点名**。只说"有文件被拒"等于没说。 */}
        {rejected.length > 0 ? (
          <ul data-testid="research-intake-rejected" className="space-y-1">
            {rejected.map((r) => (
              <li key={r.name} className="flex items-start gap-1.5 text-11 text-destructive">
                <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span>{r.name}：{r.why}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {failure ? (
          <p data-testid="research-intake-failure" className="text-11 text-destructive">
            {failure.what}。{failure.next}
          </p>
        ) : null}

        <p className="text-11 text-muted-foreground">
          已登记 {session.materials.length} 条材料
          {session.materials.length > 0 ? `（${C.PHASE_LABELS[session.phase]}）` : null}
        </p>
      </div>
    </section>
  );
}
