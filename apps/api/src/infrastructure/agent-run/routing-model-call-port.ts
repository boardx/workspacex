/**
 * `RoutingModelCallPort` -- lets more than one `ModelCallPort` coexist without loosening
 * `ConfiguredModelProvider`'s "no fallback, structurally" invariant (see that file's own
 * header: "There is no list, no map, no 'default'").
 *
 * That invariant is still true INSIDE each individual port. What changed 2026-08-07 is
 * that this deployment now runs TWO distinct execution paths -- one-shot chat completion
 * (`dashscope`) and a separate long-running LangGraph service (`open-deep-research`) --
 * and an Agent's pinned `model_provider` decides which one a run belongs to. Routing by
 * that exact string, with an explicit, closed map and a hard failure for anything not in
 * it, is the same "no fallback" discipline lifted one level up: a run naming a provider
 * nobody registered here fails `MODEL_PROVIDER_NOT_CONFIGURED`, it does not fall through
 * to whichever port happens to be first.
 */
import { ModelCallError, type ModelCallInput, type ModelCallPort } from "../../application/agent-run/ports";

export class RoutingModelCallPort implements ModelCallPort {
  constructor(private readonly ports: ReadonlyMap<string, ModelCallPort>) {}

  async complete(input: ModelCallInput): Promise<{ readonly text: string; readonly tokens?: number }> {
    const port = this.ports.get(input.modelProvider);
    if (!port) {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `no ModelCallPort registered for provider "${input.modelProvider}"`,
      );
    }
    return port.complete(input);
  }
}
