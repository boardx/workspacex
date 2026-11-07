/** Split only independent fresh-runtime branches; local full smoke keeps its graph. */
export function partitionSmokeProjects<T extends { name?: string; dependencies?: string[] }>(projects: T[], partition?: string): T[] {
  if (!partition) return projects;
  if (partition !== 'product' && partition !== 'board') throw new Error('UNKNOWN_SMOKE_PARTITION');
  const board = new Set(['board-unified-desktop', 'board-unified-mobile']);
  const names = new Set(projects.map(project => project.name));
  if (names.size !== projects.length || [...board].some(name => !names.has(name))) throw new Error('INVALID_SMOKE_GRAPH');
  // Both branches receive the complete seed from config.webServer. No test output
  // crosses runners. Keep all within-branch ordering, particularly catalog imports.
  const boundaries = new Set(['board-unified-desktop:seeded', 'seeded-github-import:board-unified-mobile']);
  for (const project of projects) for (const dependency of project.dependencies ?? []) {
    if (!names.has(dependency)) throw new Error('MISSING_SMOKE_DEPENDENCY');
    if (board.has(project.name ?? '') !== board.has(dependency) && !boundaries.has(`${project.name}:${dependency}`)) {
      throw new Error('UNREVIEWED_SMOKE_PARTITION_DEPENDENCY');
    }
  }
  return projects.filter(project => board.has(project.name ?? '') === (partition === 'board')).map(project => ({
    ...project,
    ...(project.dependencies ? { dependencies: project.dependencies.filter(dependency => board.has(dependency) === (partition === 'board')) } : {}),
  }));
}
