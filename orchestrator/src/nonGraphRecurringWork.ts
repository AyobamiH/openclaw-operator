export const NON_GRAPH_WORK_DISPOSITIONS = [
  "GRAPH_OWNED",
  "REGISTERED_IN_PROCESS",
  "REGISTERED_EVENT_DRIVEN",
  "REGISTERED_LIFECYCLE_HOOK",
  "MIGRATE_TO_GRAPH",
  "DISABLE",
  "CONDITIONAL_INACTIVE",
] as const;

export type NonGraphWorkDisposition =
  (typeof NON_GRAPH_WORK_DISPOSITIONS)[number];

export type NonGraphRecurringWorkRegistration = {
  capability: string;
  purpose: string;
  trigger: string;
  owner: string;
  state: "active" | "conditional-inactive" | "disabled";
  executionModel: string;
  effects: string;
  idempotency: string;
  concurrency: string;
  recovery: string;
  verification: string;
  reporting: string;
  externalAuthority: string;
  disposition: NonGraphWorkDisposition;
};

export const NON_GRAPH_RECURRING_WORK_REGISTRY: readonly NonGraphRecurringWorkRegistration[] = [
  {
    capability: "orchestrator-heartbeat",
    purpose: "Prove the orchestrator queue and handler path remain responsive.",
    trigger: "node-cron */5 * * * * in the orchestrator process",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "in-process cron -> heartbeat queue task",
    effects: "Local task history, workflow evidence, and liveness timestamp only.",
    idempotency: "Five-minute cadence; the handler is a bounded no-op liveness receipt.",
    concurrency: "Shared queue concurrency is two; heartbeat work is synchronous and bounded.",
    recovery: "The cron is registered again at service startup.",
    verification: "Recent heartbeat task receipt plus orchestrator service health.",
    reporting: "/api/runtime/facts and orchestrator journal.",
    externalAuthority: "None.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "openclaw-agent-heartbeats",
    purpose: "Run change-only health guards for enabled OpenClaw agents.",
    trigger: "OpenClaw Gateway heartbeat scheduler every 1 hour per enabled agent",
    owner: "openclaw-gateway.service",
    state: "active",
    executionModel: "Gateway-owned isolated, light-context agent turn",
    effects: "Change-only health evaluation; unchanged state returns HEARTBEAT_OK.",
    idempotency: "Gateway scheduler owns one heartbeat lane per enabled agent.",
    concurrency: "Gateway busy guards defer work rather than overlapping the same agent lane.",
    recovery: "Desired state is reconstructed from OpenClaw agent heartbeat configuration.",
    verification: "openclaw status --json heartbeat summary and gateway service health.",
    reporting: "OpenClaw heartbeat/session status; no default delivery target.",
    externalAuthority: "Agent-policy bounded; no provider-write authority is granted by the heartbeat contract.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "business-value-cadence",
    purpose: "Evaluate evidence-backed business-value candidates on the six-hour cadence.",
    trigger: "node-cron 17 */6 * * *",
    owner: "orchestrator.service business-value controller",
    state: "active",
    executionModel: "in-process cron -> governed business-value queue admission",
    effects: "Updates local planning state and may enqueue one safe allowlisted task.",
    idempotency: "Persisted next-run, fingerprint, cooldown, and active-cycle checks.",
    concurrency: "One active or queued business-value cycle is allowed.",
    recovery: "Startup recovery evaluates a persisted overdue nextRunAt.",
    verification: "Business-value scheduler state, task receipts, and journal decisions.",
    reporting: "Business-value state and task/workflow evidence.",
    externalAuthority: "Downstream external or irreversible actions remain approval-gated.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "business-day-pulse",
    purpose: "Evaluate the same business-value controller hourly during London business hours.",
    trigger: "node-cron 17 8-17 * * 1-5 in Europe/London",
    owner: "orchestrator.service business-value controller",
    state: "active",
    executionModel: "in-process cron -> forced governed business-value evaluation",
    effects: "Updates local planning state and may enqueue one safe allowlisted task.",
    idempotency: "Shares the controller active-cycle lock and persisted admission state.",
    concurrency: "A collision with the six-hour cadence is suppressed as active, not run twice.",
    recovery: "No backfill; the six-hour controller startup recovery covers overdue work.",
    verification: "Pulse queue/skip journal receipts and business-value state.",
    reporting: "Business-value state and task/workflow evidence.",
    externalAuthority: "Downstream external or irreversible actions remain approval-gated.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "nightly-batch",
    purpose: "Coordinate local document, RSS, queue-selection, approval, and digest preparation.",
    trigger: "node-cron 0 23 * * * in the orchestrator host timezone",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "in-process cron -> nightly-batch queue task",
    effects: "Local state, drafts, approvals, and digest artifacts; no provider publication.",
    idempotency: "One deterministic calendar-slot key is used per scheduled run.",
    concurrency: "Queue admission suppresses a duplicate slot while its execution is live or complete.",
    recovery: "No automatic missed-slot replay; the next natural slot remains authoritative.",
    verification: "lastNightlyBatchAt, task receipt, and digest artifact evidence.",
    reporting: "Task history, workflow events, and dashboard/runtime facts.",
    externalAuthority: "Read-only network fetches are allowed; provider writes are not.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "document-watching",
    purpose: "Detect changes in the managed OpenClaw and Cookbook document mirrors.",
    trigger: "Persistent chokidar add/change/unlink events after orchestrator startup",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "event-driven watcher -> doc-change queue task",
    effects: "Local index updates, a capped 200-path pending buffer, and drift-repair admission.",
    idempotency: "The pending path set deduplicates paths and the repair fingerprint deduplicates repair work.",
    concurrency: "Queue concurrency is bounded; repair locks and cooldown prevent duplicate drift repair.",
    recovery: "Initial index rebuild restores current truth after restart; watch hooks then resume.",
    verification: "Watcher receipts, pendingDocChanges, repair records, and knowledge-pack evidence.",
    reporting: "Task/workflow evidence and knowledge health surfaces.",
    externalAuthority: "None beyond local operator state and knowledge artifacts.",
    disposition: "REGISTERED_EVENT_DRIVEN",
  },
  {
    capability: "doc-specialist-service-heartbeat",
    purpose: "Report doc-specialist task-path and service health without owning drift repair.",
    trigger: "Resident service loop every 60 seconds",
    owner: "doc-specialist.service",
    state: "active",
    executionModel: "in-process observer loop",
    effects: "Writes only doc-specialist service-health state.",
    idempotency: "Each observation replaces the current service-health snapshot.",
    concurrency: "One systemd service process; each loop awaits the preceding observation.",
    recovery: "systemd Restart=always and service startup reload current orchestrator evidence.",
    verification: "Fresh serviceHeartbeat.checkedAt plus active systemd unit.",
    reporting: "Agent operational overview and service-state receipt.",
    externalAuthority: "None; direct orchestrator-state and knowledge-pack mutation is forbidden.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "missed-heartbeat-detection",
    purpose: "Raise a local critical alert when the orchestrator heartbeat is stale.",
    trigger: "setInterval every 10 minutes with a 15-minute stale threshold",
    owner: "orchestrator.service alert manager",
    state: "active",
    executionModel: "in-process monitor",
    effects: "Local alert state only.",
    idempotency: "Alert manager and deduplicator suppress repeated equivalent alerts.",
    concurrency: "Synchronous bounded check; no overlapping async work.",
    recovery: "Timer and heartbeat baseline are recreated at startup.",
    verification: "Heartbeat receipts, alert ledger, and orchestrator journal.",
    reporting: "Alert and health surfaces.",
    externalAuthority: "None.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "alert-retention-cleanup",
    purpose: "Remove orchestrator alerts older than 48 hours.",
    trigger: "setInterval every 6 hours",
    owner: "orchestrator.service alert manager",
    state: "active",
    executionModel: "in-process maintenance interval",
    effects: "Local alert retention only.",
    idempotency: "Deleting already-absent expired records is harmless.",
    concurrency: "Synchronous bounded cleanup.",
    recovery: "Timer is recreated at startup.",
    verification: "Cleanup journal receipt and alert store inspection.",
    reporting: "Alert journal and health surfaces.",
    externalAuthority: "None.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "alert-deduplication-cleanup",
    purpose: "Expire in-memory alert fingerprints that have been idle for two hours.",
    trigger: "setInterval every 1 hour from alert deduplicator initialization",
    owner: "orchestrator.service alert deduplicator",
    state: "active",
    executionModel: "in-process maintenance interval",
    effects: "In-memory fingerprint map only.",
    idempotency: "Repeated expiry scans are harmless.",
    concurrency: "Synchronous bounded cleanup.",
    recovery: "The map and timer are recreated on process startup.",
    verification: "Deduplicator startup log and getStats health data.",
    reporting: "Debug log when stale entries are removed.",
    externalAuthority: "None.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "startup-recovery",
    purpose: "Restore persisted retry timers, overdue business evaluation, watchers, and boot evidence.",
    trigger: "Once after the orchestrator HTTP listener becomes ready",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "lifecycle hook",
    effects: "Local queue/state reconciliation; no forced provider work.",
    idempotency: "A process-local startupTasksInitialized guard permits one registration pass.",
    concurrency: "Runs once per process and awaits knowledge integration startup.",
    recovery: "A subsequent service start reruns reconciliation from persisted evidence.",
    verification: "Startup task receipt and scheduler/watcher registration log.",
    reporting: "Startup journal and workflow evidence.",
    externalAuthority: "None beyond approval-bounded downstream queue work.",
    disposition: "REGISTERED_LIFECYCLE_HOOK",
  },
  {
    capability: "task-retry-recovery",
    purpose: "Requeue retryable failed tasks at their persisted retryAt time.",
    trigger: "One setTimeout per persisted idempotency key",
    owner: "orchestrator.service retry controller",
    state: "active",
    executionModel: "event-driven persisted one-shot timer",
    effects: "Local queue admission and retry evidence.",
    idempotency: "Timer map and persisted idempotency key allow one pending timer per task key.",
    concurrency: "Existing timer is cleared before replacement; Graph child/verifier failures are excluded.",
    recovery: "Pending records are reconstructed at startup; stale/interrupted records are reconciled.",
    verification: "taskRetryRecoveries state and retry workflow events.",
    reporting: "Task run, repair, and workflow evidence.",
    externalAuthority: "Inherited from the original task and still subject to its approval/tool policy.",
    disposition: "REGISTERED_EVENT_DRIVEN",
  },
  {
    capability: "review-session-sampling",
    purpose: "Capture bounded host/process/activity telemetry while one review session is active.",
    trigger: "Dynamic setInterval from the active review session capture plan",
    owner: "orchestrator.service review-session service",
    state: "conditional-inactive",
    executionModel: "event-driven conditional sampler",
    effects: "Local review telemetry samples only.",
    idempotency: "One active session and one configured timer; samples are timestamped append-only within retention.",
    concurrency: "An in-flight guard skips a tick rather than overlapping sample/flush work.",
    recovery: "Sampler state is reconstructed from any persisted active review session.",
    verification: "Review session state, sample timestamps, and timer contract tests.",
    reporting: "Review-session API and telemetry summary.",
    externalAuthority: "None.",
    disposition: "REGISTERED_EVENT_DRIVEN",
  },
  {
    capability: "github-workflow-monitor",
    purpose: "Observe the latest GitHub Actions state for the configured repository branch.",
    trigger: "setInterval every 5 minutes plus one startup observation",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "in-process trigger with Graph-backed execution when Graph runtime is enabled",
    effects: "Read-only GitHub status and local runtime cache/evidence.",
    idempotency: "Five-minute slot key plus equivalent-live-run coalescing.",
    concurrency: "Graph concurrency deferral and single-flight suppress overlapping monitor runs.",
    recovery: "Startup observation restores current status after downtime.",
    verification: "Current monitor state, Graph run receipt, and journal outcome.",
    reporting: "/api/health/extended dependency status and task history.",
    externalAuthority: "Read-only GitHub access; no repository mutation.",
    disposition: "REGISTERED_IN_PROCESS",
  },
  {
    capability: "knowledge-integration-startup",
    purpose: "Initialize the in-memory knowledge base and register its lifecycle contract.",
    trigger: "Once during deferred startup when fast-start is disabled",
    owner: "orchestrator.service knowledge integration",
    state: "active",
    executionModel: "lifecycle hook",
    effects: "Loads local knowledge state; current consolidation hook is registration-only.",
    idempotency: "Single startup pass per process.",
    concurrency: "Awaited inside deferred startup.",
    recovery: "Reinitialized from persisted local evidence after restart.",
    verification: "Knowledge startup log and /api/knowledge/summary.",
    reporting: "Knowledge summary and extended health.",
    externalAuthority: "None.",
    disposition: "REGISTERED_LIFECYCLE_HOOK",
  },
  {
    capability: "agent-overview-cache-warm",
    purpose: "Refresh the agent operational overview after invalidating events.",
    trigger: "Debounced one-shot setTimeout, default 250 ms",
    owner: "orchestrator.service",
    state: "active",
    executionModel: "event-driven cache warm",
    effects: "In-memory cache and read-only service probes.",
    idempotency: "A newer request clears and replaces the pending timer.",
    concurrency: "Pending promise coalescing permits one build per cache key.",
    recovery: "Cache is rebuilt on demand and warmed after startup.",
    verification: "Agent overview response and cache deadline logs.",
    reporting: "Agent operational overview and health surfaces.",
    externalAuthority: "None.",
    disposition: "REGISTERED_EVENT_DRIVEN",
  },
  {
    capability: "reddit-helper-service-loop",
    purpose: "Legacy resident Reddit draft polling path retained only for explicit operator activation.",
    trigger: "Systemd service loop when the disabled unit is manually started",
    owner: "reddit-helper.service",
    state: "conditional-inactive",
    executionModel: "disabled resident polling loop",
    effects: "Would create local reply drafts, processed-id state, and optional Devvit queue artifacts.",
    idempotency: "Processed draft IDs, cursor state, per-cycle cap, and failure backoff.",
    concurrency: "One disabled systemd unit; each loop awaits the preceding cycle.",
    recovery: "Explicit operator activation only; exponential backoff after failures.",
    verification: "Unit is disabled/inactive and its service-state receipt is historical.",
    reporting: "Service state and telemetry if explicitly activated.",
    externalAuthority: "No provider posting; local draft/queue mutation would occur if explicitly activated.",
    disposition: "CONDITIONAL_INACTIVE",
  },
  {
    capability: "legacy-send-digest-cron",
    purpose: "Former in-process digest delivery trigger superseded by the persistent Graph scheduler.",
    trigger: "None after reconciliation; former node-cron 0 6 * * *",
    owner: "none; continuous-marketing-digest-v1 is authoritative",
    state: "disabled",
    executionModel: "removed legacy timer",
    effects: "None.",
    idempotency: "Not applicable.",
    concurrency: "No legacy execution path remains.",
    recovery: "Graph scheduler recovery owns digest slots.",
    verification: "No legacy cron registration and Graph migration status graph_owned.",
    reporting: "Graph scheduler migration and trigger evidence.",
    externalAuthority: "None.",
    disposition: "DISABLE",
  },
] as const;

export function validateNonGraphRecurringWorkRegistry(
  registrations: readonly NonGraphRecurringWorkRegistration[] =
    NON_GRAPH_RECURRING_WORK_REGISTRY,
) {
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const registration of registrations) {
    if (seen.has(registration.capability)) {
      errors.push(`duplicate capability: ${registration.capability}`);
    }
    seen.add(registration.capability);

    for (const [key, value] of Object.entries(registration)) {
      if (typeof value === "string" && value.trim().length === 0) {
        errors.push(`${registration.capability}.${key} is empty`);
      }
    }

    if (
      registration.state === "disabled" &&
      registration.disposition !== "DISABLE"
    ) {
      errors.push(
        `${registration.capability} is disabled without DISABLE disposition`,
      );
    }
    if (
      registration.state === "conditional-inactive" &&
      registration.disposition !== "CONDITIONAL_INACTIVE" &&
      registration.disposition !== "REGISTERED_EVENT_DRIVEN"
    ) {
      errors.push(
        `${registration.capability} is conditionally inactive without an inactive/event-driven disposition`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
