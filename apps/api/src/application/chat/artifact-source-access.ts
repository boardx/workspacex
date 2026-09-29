import { resolveVisibility, type ResolveVisibilityDeps, type ResolveVisibilityInput } from './resolve-visibility';

/** The same thread and draft boundary applies to reopening and transporting Chat source. */
export async function canReadChatArtifactSource(
  deps: ResolveVisibilityDeps,
  input: ResolveVisibilityInput & { mode: string; createdBy: string },
): Promise<boolean> {
  const outcome = await resolveVisibility(deps, input);
  return outcome.kind === 'allow' && (input.mode !== 'draft' || input.createdBy === input.userId);
}
