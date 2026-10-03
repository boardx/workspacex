export function createFailureState() {
  return { hasPrimaryFailure: false, primaryFailure: undefined };
}

export function recordFailure(state, error) {
  state.primaryFailure = state.hasPrimaryFailure
    ? new AggregateError([state.primaryFailure, error], 'R05_ACCEPTANCE_FAILED')
    : error;
  state.hasPrimaryFailure = true;
}

export function reportFailure(state, output = console, terminal = process) {
  if (!state.hasPrimaryFailure) return;
  output.error('R05_SETUP_OR_ACCEPTANCE_FAILED');
  terminal.exitCode = 1;
}
