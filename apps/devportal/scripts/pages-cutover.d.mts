export interface CutoverEnvironment {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  GITHUB_SHA: string;
  [key: string]: string | undefined;
}

export interface CutoverOptions {
  env?: CutoverEnvironment;
  fetchImpl?: typeof fetch;
  deploy?: (options: { env: CutoverEnvironment }) => Promise<void>;
  smoke?: (options: { fetchImpl: typeof fetch; accessTeamDomain: string }) => Promise<void>;
  logger?: Pick<Console, "info" | "error">;
}

export function smokeProduction(options: {
  fetchImpl?: typeof fetch;
  accessTeamDomain: string;
}): Promise<void>;
export function runPagesCutover(options?: CutoverOptions): Promise<void>;
