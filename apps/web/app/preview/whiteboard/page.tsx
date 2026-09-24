import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { WhiteboardScreen } from '@/components/whiteboard/whiteboard-screen';
import { mockIdentity, MOCK_ORGS } from '@/lib/identity';
import { UI_STATES, UI_STATE_LABEL, resolvePreviewState } from '@/lib/ui-state';
/** Development-only design review; never substitutes for production identity. */
export default function WhiteboardPreviewPage({ searchParams }: { searchParams: { state?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const state = resolvePreviewState(searchParams.state);
  return <AppShell identity={mockIdentity(MOCK_ORGS[0]!.id, null)} previewRole={null} hideTopBar fullscreen>
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="预览状态" className="flex shrink-0 flex-wrap gap-2 border-b border-border bg-card p-2">
        {UI_STATES.map((item) => <Link key={item} href={`/preview/whiteboard?state=${item}`} data-testid={`whiteboard-state-${item}`} aria-current={item === state ? 'page' : undefined} className="rounded-control px-2 py-1 text-12 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{UI_STATE_LABEL[item]}</Link>)}
      </nav>
      <WhiteboardScreen key={state} state={state} />
    </div>
  </AppShell>;
}
