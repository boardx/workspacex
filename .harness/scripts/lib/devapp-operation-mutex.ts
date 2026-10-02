import { parseDocument } from "yaml";

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_OBJECT_REQUIRED`);
  return value as Record<string, unknown>;
}

/** Policy is authoritative; workflow literals are checked execution mirrors. */
export function assertDevappOperationMutex(policyInput: unknown, backendYaml: string, installerYaml: string): void {
  const policy = object(policyInput, "POLICY");
  if (policy.schemaVersion !== 1 || policy.target !== "devapp" || policy.cancelInProgress !== false
    || policy.pendingCapacity !== 1 || typeof policy.group !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(policy.group)) throw new Error("DEVAPP_MUTEX_POLICY_INVALID");
  const parse = (text: string) => {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) throw new Error("WORKFLOW_YAML_INVALID");
    return object(document.toJS(), "WORKFLOW");
  };
  const backend = parse(backendYaml);
  const installer = parse(installerYaml);
  const deploy = object(object(backend.jobs, "BACKEND_JOBS").deploy, "DEPLOY_JOB");
  // GitHub uses the same repository-wide group namespace for job and workflow
  // concurrency. A job-level installer override would bypass the workflow group.
  const installJob = object(object(installer.jobs, "INSTALLER_JOBS").install, "INSTALL_JOB");
  if (Object.hasOwn(installJob, "concurrency")) throw new Error("INSTALLER_JOB_OVERRIDE_FORBIDDEN");
  for (const [name, input] of [["deploy", deploy.concurrency], ["installer", installer.concurrency]] as const) {
    const concurrency = object(input, `${name}_CONCURRENCY`);
    if (concurrency.group !== policy.group) throw new Error(`${name}_MUTEX_GROUP_DRIFT`);
    if (concurrency["cancel-in-progress"] !== false) throw new Error(`${name}_ACTIVE_OPERATION_CANCELLATION`);
    if (Object.hasOwn(concurrency, "queue")) throw new Error(`${name}_PENDING_CAPACITY_DRIFT`);
    if (Object.keys(concurrency).some(key => !["group", "cancel-in-progress"].includes(key))) throw new Error(`${name}_UNKNOWN_CONCURRENCY_FIELD`);
  }
}
