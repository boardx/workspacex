import { CopilotKitV2Providers } from "@/app/chat/copilotkit-v2/copilotkit-v2-providers";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { RealtimeDigitalHumanWorkspace } from "@/components/whiteboard/realtime-digital-human-workspace";

export default function RealtimeDigitalHumanBoardPage({ params }: { params: { boardId: string } }): JSX.Element {
  return (
    <CopilotKitV2AgentSelectionProvider>
      <CopilotKitV2Providers>
        <RealtimeDigitalHumanWorkspace boardId={params.boardId} />
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
