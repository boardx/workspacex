export const observationCategories = Object.freeze({
  'screenshot': 'visual-heavy',
  'pixel-comparison': 'visual-heavy',
  'hit-test-measurement': 'functional-accessibility',
  'keyboard-focus': 'functional-accessibility',
  'axe': 'functional-accessibility',
  'canonical-save-sync-permission': 'functional',
});
export function observationMode(value = process.env.BOARD_OBSERVATION_MODE) {
  if (value === undefined || value === 'all') return 'all';
  if (value === 'functional') return 'functional';
  throw new Error('INVALID_BOARD_OBSERVATION_MODE');
}
export function categoryEnabled(category, mode = observationMode()) {
  if (!Object.hasOwn(observationCategories, category)) throw new Error('UNKNOWN_BOARD_OBSERVATION_CATEGORY');
  if (mode !== 'all' && mode !== 'functional') throw new Error('INVALID_BOARD_OBSERVATION_MODE');
  return mode === 'all' || observationCategories[category] !== 'visual-heavy';
}

export function observationArtifactKinds(mode = observationMode()) {
  const value = observationMode(mode);
  return value === 'all'
    ? {report:'board-visual-accessibility',bundle:'board-visual-accessibility-bundle'}
    : {report:'board-functional-accessibility',bundle:'board-functional-accessibility-bundle'};
}
