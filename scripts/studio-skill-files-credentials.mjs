export const githubImportTokenEnv = 'WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN';

export function partitionSkillImportCredentials(environment) {
  const sharedEnvironment = { ...environment };
  const token = sharedEnvironment[githubImportTokenEnv];
  delete sharedEnvironment[githubImportTokenEnv];
  return { sharedEnvironment, apiEnvironment: token ? { [githubImportTokenEnv]: token } : {} };
}
