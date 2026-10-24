import { InterviewCompletionProvider } from "@/components/itv/interview-completion-provider";

export default function InterviewLayout({ children }: { children: React.ReactNode }) {
  return <InterviewCompletionProvider>{children}</InterviewCompletionProvider>;
}
