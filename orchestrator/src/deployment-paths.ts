import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Historical deployment profile: retained to preserve existing host behaviour
 * and the exact persisted scheduler payloads. New installations can set trusted
 * process configuration without editing product code. Never derive these roots
 * from task payloads or provider input.
 */
const LEGACY_HOST_HOME = "/home/oneclickwebsitedesignfactory";
const LEGACY_OPENCLAW_HOME = join(LEGACY_HOST_HOME, ".openclaw");
const LEGACY_WORKSPACE = join(LEGACY_OPENCLAW_HOME, "workspace");
const LEGACY_STATE = join(LEGACY_OPENCLAW_HOME, "state", "openclaw-operator");
const LEGACY_BIN = join(LEGACY_HOST_HOME, ".nvm", "versions", "node", "v24.18.0", "bin");

export const LEGACY_DEPLOYMENT_PATHS = Object.freeze({
  openclawHome: LEGACY_OPENCLAW_HOME,
  workspaceRoot: LEGACY_WORKSPACE,
  operatorStateRoot: LEGACY_STATE,
  witnessStateRoot: join(LEGACY_OPENCLAW_HOME, "state", "worktree-integrity"),
  campaignRuntimeRoot: join(LEGACY_OPENCLAW_HOME, "runtime", "deterministic-self-identification-publishing-engine"),
  nodeExecutable: join(LEGACY_BIN, "node"),
  openclawBin: join(LEGACY_BIN, "openclaw"),
});

function absoluteOverride(name: string, value: string | undefined, fallback: string): string {
  const configured = value?.trim();
  if (!configured) return fallback;
  if (!isAbsolute(configured)) throw new Error(name + " must be an absolute path");
  return resolve(configured);
}

/** Trusted deployment configuration. The frozen scheduler portfolio remains
 * bound to LEGACY_DEPLOYMENT_PATHS until an explicit migration changes it. */
export function resolveDeploymentPaths(env: NodeJS.ProcessEnv = process.env) {
  const workspaceRoot = absoluteOverride("OPENCLAW_WORKSPACE_ROOT", env.OPENCLAW_WORKSPACE_ROOT, LEGACY_DEPLOYMENT_PATHS.workspaceRoot);
  const openclawHome = dirname(workspaceRoot);
  const operatorStateRoot = absoluteOverride("OPENCLAW_OPERATOR_STATE_DIR", env.OPENCLAW_OPERATOR_STATE_DIR,
    join(openclawHome, "state", "openclaw-operator"));
  return {
    workspaceRoot,
    openclawHome,
    operatorStateRoot,
    projectsRoot: join(workspaceRoot, "projects"),
    operatorIntegrityRoot: join(operatorStateRoot, "worktree-integrity"),
    openclawBin: env.OPENCLAW_BIN?.trim() || LEGACY_DEPLOYMENT_PATHS.openclawBin,
    mediaRenderer: join(workspaceRoot, "projects", "relay-live-business-engagement-connector", "local-media-renderer", "bin", "local-media-renderer.mjs"),
  };
}
