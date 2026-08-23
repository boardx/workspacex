import { AppShell } from "@/components/shell/app-shell";
import { ButtonGallery } from "@/components/state/button-gallery";
import { PrimitivesGallery, CompositePrimitivesGallery, MotionTokenGallery } from "@/components/state/primitives-gallery";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { StateDemo } from "@/components/state/state-demo";
import { resolvePreviewState, UI_STATE_LABEL } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { FONT_SCALE } from "@/lib/font-scale";

/**
 * 样板页 —— 设计系统的**活文档**，不是演示页。
 * ui-prototyper 画新屏前先来这里看有什么组件、七态长什么样。
 *
 * ⚠ 路由名与 UC-0.4 R8 写的 `/_kitchen-sink` 不同：Next.js App Router 把下划线开头的
 *   目录视为私有目录、**不生成路由**，故改为 `/kitchen-sink`。这是实现层的必要偏离，
 *   已按 UC-0.4 R10「以规范的意图为准、修正规范的表述」处理。
 */
export default function KitchenSinkPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<SampleLeftPanel />}
      right={<SampleRightPanel />}
    >
      <div className="flex flex-col gap-8 p-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-20 font-semibold tracking-tight">组件与状态样板</h1>
          <p className="text-13 text-muted-foreground">
            设计 token 的唯一事实源是 <code className="font-mono text-12">app/globals.css</code>，
            字号档位是 <code className="font-mono text-12">lib/font-scale.ts</code>。
            两者都由脚本机械把关，改值请回到源文件。
          </p>
        </header>

        {/* ── 七种必现状态 ─────────────────────────────────────── */}
        <section className="flex flex-col gap-3" data-testid="section-states">
          <div className="flex flex-col gap-1">
            <h2 className="text-16 font-semibold">七种必现状态</h2>
            <p className="text-12 text-muted-foreground">
              D-36 裁定「按统一规范实现、sign-off 豁免逐屏设计」——本组件就是那个统一规范。
              当前：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
            </p>
          </div>
          <StatePreviewSwitcher current={state} />
          <Card>
            <CardContent className="pt-4">
              <StateDemo state={state} />
            </CardContent>
          </Card>
        </section>

        {/* ── 按钮 ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3" data-testid="section-buttons">
          <h2 className="text-16 font-semibold">按钮</h2>
          <ButtonGallery />
          <p className="text-11 text-muted-foreground">
            禁用态用 <code className="font-mono">bg-disabled</code> +{" "}
            <code className="font-mono">text-disabled-foreground</code>（5.85:1，禁用但可读），
            <strong className="text-background-foreground">不是 opacity</strong>——
            后者会把深色实心按钮压成 ~2:1 的灰对灰。
          </p>
        </section>

        {/* ── 表单 ─────────────────────────────────────────────── */}
        <section className="flex max-w-sm flex-col gap-3" data-testid="section-form">
          <h2 className="text-16 font-semibold">表单</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ks-email">邮箱</Label>
            <Input id="ks-email" type="email" placeholder="you@example.com" data-testid="demo-input-email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ks-disabled">禁用输入</Label>
            <Input id="ks-disabled" disabled defaultValue="不可编辑" data-testid="demo-input-disabled" />
          </div>
        </section>

        {/* ── 标记 ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3" data-testid="section-badges">
          <h2 className="text-16 font-semibold">标记</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">草稿</Badge>
            <Badge tone="primary">已定版</Badge>
            <Badge tone="ai">AVA 改动</Badge>
            <Badge tone="warning">待人工指派</Badge>
            <Badge tone="danger">已撤回</Badge>
            <Badge tone="outline">未探明</Badge>
          </div>
        </section>

        {/* ── 弹层原语（interaction-primitives F01/F02）───────────── */}
        <PrimitivesGallery />

        {/* ── 复合组件（interaction-primitives F09：Table / Menu）──── */}
        <CompositePrimitivesGallery />

        {/* ── 动效 token 档位（motion-microinteraction F03/F04）────── */}
        <MotionTokenGallery />

        {/* ── 字号档位 ─────────────────────────────────────────── */}
        <section className="flex flex-col gap-3" data-testid="section-typography">
          <div className="flex flex-col gap-1">
            <h2 className="text-16 font-semibold">字号档位</h2>
            <p className="text-12 text-muted-foreground">
              全部来自 <code className="font-mono">lib/font-scale.ts</code>。
              新增档位只改那一处——tailwind 类、tailwind-merge 识别、lint 白名单会自动同步。
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {Object.entries(FONT_SCALE).map(([key, [size]]) => (
              <div key={key} className="flex items-baseline gap-3 border-b border-border-subtle pb-1.5">
                <code className="w-20 shrink-0 font-mono text-11 text-muted-foreground">text-{key}</code>
                <code className="w-20 shrink-0 font-mono text-11 text-muted-foreground">{size}</code>
                <span style={{ fontSize: size }}>把一场项目从进场跑到产出</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function SampleLeftPanel() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <h2 className="text-13 font-semibold">左栏 · 272px</h2>
      <p className="text-11 text-muted-foreground">
        实测宽度。承载列表/线程/目录树这类导航性内容。
      </p>
      <ul className="flex flex-col gap-1">
        {["欧洲储能进入策略 · 假设梳理", "德国工商储电价机制核查", "客户访谈 07 · 采购总监"].map((t, i) => (
          <li
            key={t}
            data-testid={`demo-thread-${i}`}
            className="cursor-pointer rounded-md px-2 py-1.5 text-12 transition-all duration-base hover:bg-muted"
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SampleRightPanel() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <h2 className="text-13 font-semibold">右栏 · 300px</h2>
      <p className="text-11 text-muted-foreground">
        实测宽度。承载上下文包与证据栏（UC-0.2）——「AI 这次读了什么、丢弃了什么」。
      </p>
      <div className="rounded-md border border-border bg-card p-2.5">
        <p className="text-11 font-medium">本次 Context Pack</p>
        <p className="mt-1 text-10 text-muted-foreground">
          12 条证据 · 3 条 Claim · 4 条被筛除（可查看原因）
        </p>
      </div>
    </div>
  );
}
