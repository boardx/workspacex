import type { AsrUsageEvent, AsrUsageMeter } from "../../application/recording/personal-realtime-asr";
export class InMemoryAsrUsageMeter implements AsrUsageMeter {
  readonly events: AsrUsageEvent[] = [];
  private readonly tasks = new Set<string>();
  async record(event: AsrUsageEvent): Promise<boolean> {
    if (this.tasks.has(event.providerTaskId)) return false;
    this.tasks.add(event.providerTaskId); this.events.push(event); return true;
  }
}
