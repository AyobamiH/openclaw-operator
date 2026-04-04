import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTaskCatalog, useTriggerTask } from "@/hooks/use-console-api";
import { useAuth } from "@/contexts/AuthContext";
import { SummaryCard } from "@/components/console/SummaryCard";
import { JsonRenderer } from "@/components/console/JsonRenderer";
import { StatusBadge } from "@/components/console/StatusBadge";
import { ScrollReveal } from "@/components/console/ScrollReveal";
import { TaskBentoCard } from "@/components/console/TaskBentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Play, AlertTriangle, CheckCircle2, Zap, Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { bool, num, str, toArray } from "@/lib/safe-render";

// ── Flat task row view model ──
interface TaskRowVM {
  type: string;
  label: string;
  purpose: string;
  operationalStatus: string;
  approvalGated: boolean;
  category: TaskCategory;
  dependencyClass: string;
  dependencyRequirements: string[];
  baselineConfidence: string;
  availabilityLabel: string;
  caveats: string[];
  totalRuns: number;
  successRate: string;
}

interface TaskDraftState {
  heartbeatReason: string;
  controlPlaneFocus: string;
  buildMode: "autonomous" | "explicit";
  buildType: string;
  buildScope: string;
  buildIntent: string;
  buildMaxFilesChanged: string;
  buildRunTests: boolean;
  buildTestCommand: string;
  buildChangesJson: string;
  marketMode: "query" | "url";
  marketScope: string;
  marketQuery: string;
  marketUrls: string;
  driftRequestedBy: string;
  driftPaths: string;
  driftTargets: string;
  driftNotes: string;
  redditResponder: string;
  redditSubreddit: string;
  redditQuestion: string;
  redditLink: string;
  redditSuggestedReply: string;
  redditTag: string;
  redditScore: string;
  redditSelectedForDraft: boolean;
  securityType: string;
  securityScope: string;
  summarizeSourceType: string;
  summarizeFormat: string;
  summarizeContent: string;
  summarizeMetadata: string;
  summarizeConstraints: string;
  monitorType: string;
  monitorAgents: string;
  incidentTriageClassification: string;
  incidentTriageLimit: string;
  contentType: string;
  contentSourceName: string;
  contentSourceDescription: string;
  contentStyle: string;
  contentLength: string;
  workflowType: string;
  workflowSteps: string;
  normalizeType: string;
  normalizeInput: string;
  normalizeSchema: string;
  extractionSourceType: string;
  extractionSourceValue: string;
  extractionSchema: string;
  qaTarget: string;
  qaTargetAgentId: string;
  qaSuite: string;
  qaMode: string;
  qaTestCommand: string;
  qaDryRun: boolean;
  qaConstraints: string;
  releaseTarget: string;
  skillAuditIds: string;
  skillAuditDepth: string;
  skillAuditChecks: string;
  rssConfigPath: string;
  rssDraftsPath: string;
  deployAgentName: string;
  deployTemplate: string;
  deployTemplatePath: string;
  deployRepoPath: string;
  deployConfig: string;
  deployNotes: string;
}

const DEFAULT_TASK_DRAFT: TaskDraftState = {
  heartbeatReason: "operator-station",
  controlPlaneFocus: "",
  buildMode: "autonomous",
  buildType: "refactor",
  buildScope: "orchestrator/src",
  buildIntent: "Repair the bounded runtime/operator issue inside this scope and preserve rollback evidence.",
  buildMaxFilesChanged: "10",
  buildRunTests: true,
  buildTestCommand: "build-verify",
  buildChangesJson: "",
  marketMode: "query",
  marketScope: "general",
  marketQuery: "What changed recently in the relevant market?",
  marketUrls: "",
  driftRequestedBy: "operator-station",
  driftPaths: "",
  driftTargets: "",
  driftNotes: "",
  redditResponder: "reddit-helper",
  redditSubreddit: "",
  redditQuestion: "",
  redditLink: "",
  redditSuggestedReply: "",
  redditTag: "draft",
  redditScore: "0.85",
  redditSelectedForDraft: true,
  securityType: "scan",
  securityScope: "workspace",
  summarizeSourceType: "document",
  summarizeFormat: "executive_summary",
  summarizeContent: "",
  summarizeMetadata: "",
  summarizeConstraints: "",
  monitorType: "health",
  monitorAgents: "",
  incidentTriageClassification: "",
  incidentTriageLimit: "8",
  contentType: "readme",
  contentSourceName: "Project",
  contentSourceDescription: "Generated content",
  contentStyle: "",
  contentLength: "",
  workflowType: "workflow",
  workflowSteps: "",
  normalizeType: "normalize",
  normalizeInput: "[]",
  normalizeSchema: "{}",
  extractionSourceType: "inline",
  extractionSourceValue: "",
  extractionSchema: "",
  qaTarget: "workspace",
  qaTargetAgentId: "",
  qaSuite: "smoke",
  qaMode: "",
  qaTestCommand: "",
  qaDryRun: true,
  qaConstraints: "",
  releaseTarget: "main",
  skillAuditIds: "",
  skillAuditDepth: "standard",
  skillAuditChecks: "",
  rssConfigPath: "",
  rssDraftsPath: "",
  deployAgentName: "",
  deployTemplate: "",
  deployTemplatePath: "",
  deployRepoPath: "",
  deployConfig: "",
  deployNotes: "",
};

type TaskCategory = "Routine" | "Repair" | "Research" | "Governance" | "Sensitive";

const TASK_CATEGORY_ORDER: TaskCategory[] = [
  "Routine",
  "Repair",
  "Research",
  "Governance",
  "Sensitive",
];

const TASK_CATEGORY_COPY: Record<TaskCategory, string> = {
  Routine: "Daily bounded control-plane actions that keep the operator loop moving.",
  Repair: "Remediation and verification flows for drift, breakage, and runtime pressure.",
  Research: "Evidence-gathering and summarization actions with dependency-sensitive outputs.",
  Governance: "Policy, audit, and trust posture work for the governed runtime.",
  Sensitive: "Higher-risk or approval-gated work that needs extra operator intent.",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  "confirmed-working": "Available Now",
  "partially-operational": "Partially Available",
  "externally-dependent": "Externally Dependent",
  unconfirmed: "Not Yet Verified",
};

function categorizeTask(taskType: string): TaskCategory {
  const categoryMap: Record<string, TaskCategory> = {
    "doc-sync": "Routine",
    "nightly-batch": "Routine",
    "send-digest": "Routine",
    "integration-workflow": "Routine",
    "control-plane-brief": "Routine",
    "drift-repair": "Repair",
    "qa-verification": "Repair",
    "system-monitor": "Repair",
    "incident-triage": "Repair",
    "build-refactor": "Sensitive",
    "market-research": "Research",
    "summarize-content": "Research",
    "data-extraction": "Research",
    "content-generate": "Research",
    "security-audit": "Governance",
    "skill-audit": "Governance",
    "normalize-data": "Governance",
    "release-readiness": "Governance",
    "reddit-response": "Sensitive",
    "agent-deploy": "Sensitive",
  };

  return categoryMap[taskType] ?? "Routine";
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonInput<T>(value: string, label: string, fallback?: T): T | undefined {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function parseWorkflowSteps(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = parseJsonInput<unknown>(trimmed, "Workflow steps", []);
    if (!Array.isArray(parsed)) {
      throw new Error("Workflow steps JSON must be an array");
    }
    return parsed;
  }

  return parseLines(trimmed).map((detail, index) => ({
    id: `step-${index + 1}`,
    detail,
  }));
}

function parseBuildChanges(value: string): Array<Record<string, unknown>> {
  const parsed = parseJsonInput<unknown>(value, "Build changes JSON");
  if (!Array.isArray(parsed)) {
    throw new Error("Build changes JSON must be an array of change objects");
  }
  return parsed as Array<Record<string, unknown>>;
}

function buildTaskRows(catalog: any): TaskRowVM[] {
  const tasks = toArray(catalog?.tasks);
  return tasks
    .filter((t: any) => t?.exposeInV1 !== false && !t?.internalOnly)
    .map((t: any) => {
      const tel = t?.telemetryOverlay;
      const operationalStatus = str(t?.operationalStatus, "unknown");
      return {
        type: str(t?.type, "unknown"),
        label: str(t?.label, "Unknown Task"),
        purpose: str(t?.purpose, "—"),
        operationalStatus,
        approvalGated: bool(t?.approvalGated),
        category: categorizeTask(str(t?.type, "unknown")),
        dependencyClass: str(t?.dependencyClass, "worker"),
        dependencyRequirements: toArray<string>(t?.dependencyRequirements).map((value) => str(value, "")).filter(Boolean),
        baselineConfidence: str(t?.baselineConfidence, "medium"),
        availabilityLabel: AVAILABILITY_LABELS[operationalStatus] ?? "Check Runtime Status",
        caveats: toArray<string>(t?.caveats).map(c => str(c, "")),
        totalRuns: num(tel?.totalRuns),
        successRate: tel?.successRate != null ? `${(num(tel.successRate) * 100).toFixed(0)}%` : "—",
      };
    });
}

function buildTaskPayload(taskType: string, draft: TaskDraftState): Record<string, unknown> {
  if (taskType === "control-plane-brief") {
    return {
      ...(draft.controlPlaneFocus.trim()
        ? { focus: draft.controlPlaneFocus.trim() }
        : {}),
    };
  }

  if (taskType === "build-refactor") {
    const maxFilesChanged = Number.parseInt(draft.buildMaxFilesChanged, 10);
    const payload: Record<string, unknown> = {
      type: draft.buildType,
      scope: draft.buildScope.trim() || "orchestrator/src",
      ...(draft.buildIntent.trim() ? { intent: draft.buildIntent.trim() } : {}),
      constraints: {
        runTests: draft.buildRunTests,
        maxFilesChanged: Number.isFinite(maxFilesChanged) && maxFilesChanged > 0 ? maxFilesChanged : 10,
      },
    };

    if (draft.buildRunTests) {
      payload.testCommand = draft.buildTestCommand.trim() || "build-verify";
    }

    if (draft.buildMode === "explicit") {
      const changes = parseBuildChanges(draft.buildChangesJson);
      if (changes.length === 0) {
        throw new Error("Explicit build-refactor mode requires at least one change");
      }
      payload.changes = changes;
    }

    return payload;
  }

  if (taskType === "market-research") {
    const payload: Record<string, unknown> = {
      query: draft.marketQuery.trim(),
      scope: draft.marketScope.trim() || "general",
    };

    if (draft.marketMode === "url") {
      payload.urls = draft.marketUrls
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return payload;
  }

  if (taskType === "doc-sync" || taskType === "nightly-batch" || taskType === "send-digest") {
    return {};
  }

  if (taskType === "drift-repair") {
    const paths = parseLines(draft.driftPaths);
    const targets = parseLines(draft.driftTargets);
    const notes = draft.driftNotes.trim();
    return {
      requestedBy: draft.driftRequestedBy.trim() || "operator-station",
      ...(paths.length ? { paths } : {}),
      ...(targets.length ? { targets } : {}),
      ...(notes ? { notes } : {}),
    };
  }

  if (taskType === "reddit-response") {
    const subreddit = draft.redditSubreddit.trim();
    const question = draft.redditQuestion.trim();
    const link = draft.redditLink.trim();
    const suggestedReply = draft.redditSuggestedReply.trim();
    const score = Number.parseFloat(draft.redditScore);
    if (!subreddit && !question && !link && !suggestedReply) {
      return { responder: draft.redditResponder.trim() || "reddit-helper" };
    }
    return {
      responder: draft.redditResponder.trim() || "reddit-helper",
      queue: {
        subreddit: subreddit || "r/OpenClaw",
        question: question || "Operator-submitted Reddit response draft",
        ...(link ? { link } : {}),
        ...(suggestedReply ? { suggestedReply } : {}),
        ...(draft.redditTag.trim() ? { tag: draft.redditTag.trim() } : {}),
        ...(Number.isFinite(score) ? { score } : {}),
        selectedForDraft: draft.redditSelectedForDraft,
      },
    };
  }

  if (taskType === "security-audit") {
    return {
      type: draft.securityType,
      scope: draft.securityScope.trim() || "workspace",
    };
  }

  if (taskType === "summarize-content") {
    return {
      sourceType: draft.summarizeSourceType,
      format: draft.summarizeFormat,
      content: draft.summarizeContent,
      metadata: parseJsonInput<Record<string, unknown>>(draft.summarizeMetadata, "Metadata JSON"),
      constraints: parseJsonInput<Record<string, unknown>>(draft.summarizeConstraints, "Constraints JSON"),
    };
  }

  if (taskType === "system-monitor") {
    const agents = parseLines(draft.monitorAgents);
    return {
      type: draft.monitorType,
      ...(agents.length ? { agents } : {}),
    };
  }

  if (taskType === "incident-triage") {
    const parsedLimit = Number.parseInt(draft.incidentTriageLimit, 10);
    return {
      ...(draft.incidentTriageClassification.trim()
        ? { classification: draft.incidentTriageClassification.trim() }
        : {}),
      ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
    };
  }

  if (taskType === "content-generate") {
    const style = draft.contentStyle.trim();
    const length = draft.contentLength.trim();
    return {
      type: draft.contentType,
      source: {
        name: draft.contentSourceName.trim() || "Project",
        description: draft.contentSourceDescription.trim() || "Generated content",
      },
      ...(style ? { style } : {}),
      ...(length ? { length } : {}),
    };
  }

  if (taskType === "integration-workflow") {
    return {
      type: draft.workflowType.trim() || "workflow",
      steps: parseWorkflowSteps(draft.workflowSteps),
    };
  }

  if (taskType === "normalize-data") {
    return {
      type: draft.normalizeType.trim() || "normalize",
      input: parseJsonInput<unknown>(draft.normalizeInput, "Input JSON", []),
      schema: parseJsonInput<Record<string, unknown>>(draft.normalizeSchema, "Schema JSON", {}),
    };
  }

  if (taskType === "data-extraction") {
    const sourceValue = draft.extractionSourceValue.trim();
    const source =
      draft.extractionSourceType === "url"
        ? { type: "url", url: sourceValue }
        : draft.extractionSourceType === "file"
          ? { type: "file", path: sourceValue }
          : { type: "inline", content: sourceValue };
    return {
      source,
      schema: parseJsonInput<Record<string, unknown>>(draft.extractionSchema, "Schema JSON"),
    };
  }

  if (taskType === "qa-verification") {
    const targetAgentId = draft.qaTargetAgentId.trim();
    const mode = draft.qaMode.trim();
    const testCommand = draft.qaTestCommand.trim();
    return {
      target: draft.qaTarget.trim() || "workspace",
      ...(targetAgentId ? { targetAgentId } : {}),
      suite: draft.qaSuite,
      ...(mode ? { mode } : {}),
      ...(testCommand ? { testCommand } : {}),
      dryRun: draft.qaDryRun,
      constraints: parseJsonInput<Record<string, unknown>>(draft.qaConstraints, "Constraints JSON"),
    };
  }

  if (taskType === "release-readiness") {
    return {
      ...(draft.releaseTarget.trim()
        ? { releaseTarget: draft.releaseTarget.trim() }
        : {}),
    };
  }

  if (taskType === "skill-audit") {
    const skillIds = parseLines(draft.skillAuditIds);
    const checks = parseLines(draft.skillAuditChecks);
    return {
      ...(skillIds.length ? { skillIds } : {}),
      depth: draft.skillAuditDepth,
      ...(checks.length ? { checks } : {}),
    };
  }

  if (taskType === "rss-sweep") {
    const configPath = draft.rssConfigPath.trim();
    const draftsPath = draft.rssDraftsPath.trim();
    return {
      ...(configPath ? { configPath } : {}),
      ...(draftsPath ? { draftsPath } : {}),
    };
  }

  if (taskType === "agent-deploy") {
    const agentName = draft.deployAgentName.trim();
    if (!agentName) {
      throw new Error("Agent name is required for agent deploy");
    }
    const template = draft.deployTemplate.trim();
    const templatePath = draft.deployTemplatePath.trim();
    const repoPath = draft.deployRepoPath.trim();
    const notes = draft.deployNotes.trim();
    return {
      agentName,
      ...(template ? { template } : {}),
      ...(templatePath ? { templatePath } : {}),
      ...(repoPath ? { repoPath } : {}),
      config: parseJsonInput<Record<string, unknown>>(draft.deployConfig, "Config JSON"),
      ...(notes ? { notes } : {}),
    };
  }

  return {};
}

function buildExecutionPathCopy(task: TaskRowVM, draft: TaskDraftState) {
  if (task.type === "control-plane-brief") {
    return "Submission enters the orchestrator queue, the operations-analyst worker fuses dashboard, queue, incident, approval, service, and proof truth into a bounded control-plane brief for operator or companion consumption.";
  }

  if (task.type === "build-refactor") {
    return draft.buildMode === "explicit"
      ? "Submission enters the orchestrator queue, pauses for approval, then the worker applies your exact bounded changes[] patch set and records rollback plus verification evidence."
      : "Submission enters the orchestrator queue, pauses for approval, then the worker scans the declared scope for supported repository transforms, synthesizes bounded patches inside the file limit, applies them, and records rollback plus verification evidence.";
  }

  if (task.type === "integration-workflow") {
    return "Submission enters the orchestrator queue, the integration agent normalizes shorthand or empty step payloads into a bounded workflow plan, then records delegation, dependency, tool, and verifier-handoff evidence for the operator.";
  }

  if (task.type === "reddit-response") {
    return "Submission enters the orchestrator queue, the reddit-helper worker pulls the latest knowledge pack plus runtime doctrine, drafts a bounded reply, and marks the run for review when provider posture or knowledge freshness is not green.";
  }

  if (task.type === "incident-triage") {
    return "Submission enters the orchestrator queue, the system-monitor worker clusters current incident pressure into acknowledgement, ownership, remediation, and verification priorities, then returns a ranked triage queue instead of a generic runtime monitor blob.";
  }

  if (task.type === "release-readiness") {
    return "Submission enters the orchestrator queue, the release-manager worker fuses verification, security, monitor, build, incident, approval, and proof freshness evidence into a bounded go, hold, or block release posture.";
  }

  return "Submission enters the orchestrator queue, pauses for approval when required, then continues to worker execution and downstream result handling.";
}

function buildNextStepCopy(task: TaskRowVM, draft: TaskDraftState) {
  if (task.type === "control-plane-brief") {
    return "Use this when you need a portable control-plane summary instead of a full dashboard walkthrough. Add a focus string only when you want the resulting brief to emphasize one bounded angle such as incidents, approvals, or proof.";
  }

  if (task.type === "build-refactor") {
    return draft.buildMode === "explicit"
      ? "Use explicit mode when you already know the exact diff. Keep the scope tight, keep the file budget honest, and attach a real verification command when code paths are affected."
      : "Use autonomous mode when you want the worker to derive the patch from repo evidence. Keep the scope specific, describe the operator intent, and expect approval plus post-edit verification before closure.";
  }

  if (task.type === "integration-workflow") {
    return "Leave steps blank for the bounded default plan, or provide shorthand lines like `market-research: operator console trends` and `qa-verification: workflow closure`. Use explicit dependencies only when you need a custom replay path.";
  }

  if (task.type === "reddit-response") {
    return "Use the queue shortcut for the next selected draft, or supply a bounded manual queue payload. If the resulting run says the docs mirror is ahead of the latest pack, run Drift Repair before you reuse the reply broadly.";
  }

  if (task.type === "incident-triage") {
    return "Use this when the incident queue feels noisy and you need a ranked operator order. Add a classification only when you want to isolate one dominant incident family instead of the full open ledger.";
  }

  if (task.type === "release-readiness") {
    return "Use this before a real cutover or public claim. Keep the release target honest, and treat hold or block posture as real gating evidence rather than optional commentary.";
  }

  if (task.operationalStatus === "partially-operational") {
    return "This lane is live, but dependency pressure still matters. Review the caveats and dependency badges before you submit it as your next move.";
  }

  if (task.operationalStatus === "externally-dependent") {
    return "Treat this as a real task with external dependency risk. Submit it only when the required network or provider surface is actually available.";
  }

  if (task.operationalStatus === "unconfirmed") {
    return "This lane is exposed, but it still needs caution. Prefer narrow inputs and verify the resulting run before you rely on it operationally.";
  }

  return "This lane is ready to use through the normal operator flow. Keep the payload bounded and use the preview to confirm exactly what will be queued.";
}

function renderTaskFields(
  task: TaskRowVM,
  draft: TaskDraftState,
  updateDraft: (patch: Partial<TaskDraftState>) => void,
) {
  if (task.type === "control-plane-brief") {
    return (
      <>
        <div className="console-inset p-3 rounded-sm">
          <p className="text-[10px] font-mono text-foreground leading-relaxed">
            This lane produces a bounded machine-readable and operator-readable control-plane brief. Leave focus blank for a general brief, or narrow it to one concern like incidents, approvals, proof, or queue posture.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Focus
          </label>
          <Input
            value={draft.controlPlaneFocus}
            onChange={(event) => updateDraft({ controlPlaneFocus: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="incidents"
          />
        </div>
      </>
    );
  }

  if (task.type === "build-refactor") {
    const buildModeCopy =
      draft.buildMode === "explicit"
        ? "Explicit mode applies the exact changes[] payload you supply. Use it when you already know the precise patch you want reviewed and approved."
        : "Autonomous mode synthesizes bounded repo patches from real scope evidence. Use it when you want the worker to derive the patch from the files inside the declared scope.";

    return (
      <>
        <div className="console-inset p-3 rounded-sm space-y-2">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Build-Refactor Lane</p>
          <p className="text-[10px] font-mono text-foreground leading-relaxed">{buildModeCopy}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Execution Mode
            </label>
            <Select
              value={draft.buildMode}
              onValueChange={(value: "autonomous" | "explicit") => updateDraft({ buildMode: value })}
            >
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="autonomous">Autonomous Synthesis</SelectItem>
                <SelectItem value="explicit">Explicit Patch Set</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Operation Type
            </label>
            <Select value={draft.buildType} onValueChange={(value) => updateDraft({ buildType: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="refactor">Refactor</SelectItem>
                <SelectItem value="scan_security">Security Scan</SelectItem>
                <SelectItem value="optimize_performance">Optimize Performance</SelectItem>
                <SelectItem value="deduplicate">Deduplicate</SelectItem>
                <SelectItem value="modernize">Modernize</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Scope
            </label>
            <Input
              value={draft.buildScope}
              onChange={(event) => updateDraft({ buildScope: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="orchestrator/src"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Verification Command
            </label>
            <Select value={draft.buildTestCommand} onValueChange={(value) => updateDraft({ buildTestCommand: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="build-verify">build-verify</SelectItem>
                <SelectItem value="type-check">type-check</SelectItem>
                <SelectItem value="lint">lint</SelectItem>
                <SelectItem value="unit-tests">unit-tests</SelectItem>
                <SelectItem value="integration-tests">integration-tests</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Operator Intent
          </label>
          <Textarea
            value={draft.buildIntent}
            onChange={(event) => updateDraft({ buildIntent: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
            placeholder="Describe the bounded repair or refactor outcome you want inside this scope."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Max Files Changed
            </label>
            <Input
              type="number"
              min="1"
              value={draft.buildMaxFilesChanged}
              onChange={(event) => updateDraft({ buildMaxFilesChanged: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
          <label className="console-inset p-3 rounded-sm flex items-center gap-2 mt-6 sm:mt-0">
            <input
              type="checkbox"
              checked={draft.buildRunTests}
              onChange={(event) => updateDraft({ buildRunTests: event.target.checked })}
            />
            <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
              Run tests in workflow
            </span>
          </label>
        </div>
        {draft.buildMode === "explicit" && (
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Changes JSON
            </label>
            <Textarea
              value={draft.buildChangesJson}
              onChange={(event) => updateDraft({ buildChangesJson: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm min-h-[180px]"
              placeholder={`[
  {
    "file": "operator-s-console/src/pages/TasksPage.tsx",
    "operation": "replace",
    "oldText": "scope: draft.buildScope.trim() || \\"src\\"",
    "newText": "scope: draft.buildScope.trim() || \\"orchestrator/src\\""
  }
]`}
            />
          </div>
        )}
      </>
    );
  }

  if (task.type === "market-research") {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Mode
            </label>
            <Select
              value={draft.marketMode}
              onValueChange={(value: "query" | "url") => updateDraft({ marketMode: value })}
            >
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="query">Query-only</SelectItem>
                <SelectItem value="url">URL fetch mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Scope
            </label>
            <Input
              value={draft.marketScope}
              onChange={(event) => updateDraft({ marketScope: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Query
          </label>
          <Textarea
            value={draft.marketQuery}
            onChange={(event) => updateDraft({ marketQuery: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
          />
        </div>
        {draft.marketMode === "url" && (
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              URLs
            </label>
            <Textarea
              value={draft.marketUrls}
              onChange={(event) => updateDraft({ marketUrls: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
              placeholder="https://example.com&#10;https://another.example.com"
            />
          </div>
        )}
      </>
    );
  }

  if (task.type === "doc-sync" || task.type === "nightly-batch" || task.type === "send-digest") {
    return (
      <div className="console-inset p-3 rounded-sm">
        <p className="text-[10px] font-mono text-foreground leading-relaxed">
          This task does not require additional operator payload. Submission will queue the default backend action.
        </p>
      </div>
    );
  }

  if (task.type === "drift-repair") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Requested By
          </label>
          <Input
            value={draft.driftRequestedBy}
            onChange={(event) => updateDraft({ driftRequestedBy: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Paths
          </label>
          <Textarea
            value={draft.driftPaths}
            onChange={(event) => updateDraft({ driftPaths: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[100px]"
            placeholder="docs/reference/api.md&#10;src/index.ts"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Targets
          </label>
          <Textarea
            value={draft.driftTargets}
            onChange={(event) => updateDraft({ driftTargets: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
            placeholder="doc-specialist&#10;reddit-helper"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Notes
          </label>
          <Textarea
            value={draft.driftNotes}
            onChange={(event) => updateDraft({ driftNotes: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
          />
        </div>
      </>
    );
  }

  if (task.type === "reddit-response") {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Responder
            </label>
            <Input
              value={draft.redditResponder}
              onChange={(event) => updateDraft({ redditResponder: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Queue Tag
            </label>
            <Select value={draft.redditTag} onValueChange={(value) => updateDraft({ redditTag: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">draft</SelectItem>
                <SelectItem value="manual-review">manual-review</SelectItem>
                <SelectItem value="priority">priority</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Subreddit
            </label>
            <Input
              value={draft.redditSubreddit}
              onChange={(event) => updateDraft({ redditSubreddit: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="r/OpenClaw"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Score
            </label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draft.redditScore}
              onChange={(event) => updateDraft({ redditScore: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Question
          </label>
          <Textarea
            value={draft.redditQuestion}
            onChange={(event) => updateDraft({ redditQuestion: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
            placeholder="Leave blank to consume the next selected queue item."
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Suggested Reply
          </label>
          <Textarea
            value={draft.redditSuggestedReply}
            onChange={(event) => updateDraft({ redditSuggestedReply: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Link
          </label>
          <Input
            value={draft.redditLink}
            onChange={(event) => updateDraft({ redditLink: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="https://reddit.com/..."
          />
        </div>
        <label className="console-inset p-3 rounded-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.redditSelectedForDraft}
            onChange={(event) => updateDraft({ redditSelectedForDraft: event.target.checked })}
          />
          <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
            Mark manual item as selected-for-draft
          </span>
        </label>
      </>
    );
  }

  if (task.type === "security-audit") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Audit Type
          </label>
          <Select value={draft.securityType} onValueChange={(value) => updateDraft({ securityType: value })}>
            <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scan">scan</SelectItem>
              <SelectItem value="policy_review">policy_review</SelectItem>
              <SelectItem value="secrets_posture">secrets_posture</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Scope
          </label>
          <Input
            value={draft.securityScope}
            onChange={(event) => updateDraft({ securityScope: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
      </div>
    );
  }

  if (task.type === "summarize-content") {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Source Type
            </label>
            <Select
              value={draft.summarizeSourceType}
              onValueChange={(value) => updateDraft({ summarizeSourceType: value })}
            >
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="document">document</SelectItem>
                <SelectItem value="transcript">transcript</SelectItem>
                <SelectItem value="report">report</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Format
            </label>
            <Select value={draft.summarizeFormat} onValueChange={(value) => updateDraft({ summarizeFormat: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="executive_summary">executive_summary</SelectItem>
                <SelectItem value="bullet_digest">bullet_digest</SelectItem>
                <SelectItem value="incident_brief">incident_brief</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Content
          </label>
          <Textarea
            value={draft.summarizeContent}
            onChange={(event) => updateDraft({ summarizeContent: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[120px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Metadata JSON
          </label>
          <Textarea
            value={draft.summarizeMetadata}
            onChange={(event) => updateDraft({ summarizeMetadata: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
            placeholder='{"title":"Incident review"}'
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Constraints JSON
          </label>
          <Textarea
            value={draft.summarizeConstraints}
            onChange={(event) => updateDraft({ summarizeConstraints: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
            placeholder='{"maxWords":250}'
          />
        </div>
      </>
    );
  }

  if (task.type === "system-monitor") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Monitor Type
          </label>
          <Select value={draft.monitorType} onValueChange={(value) => updateDraft({ monitorType: value })}>
            <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="health">health</SelectItem>
              <SelectItem value="incident">incident</SelectItem>
              <SelectItem value="proof">proof</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Agents
          </label>
          <Textarea
            value={draft.monitorAgents}
            onChange={(event) => updateDraft({ monitorAgents: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[100px]"
            placeholder="doc-specialist&#10;system-monitor-agent"
          />
        </div>
      </>
    );
  }

  if (task.type === "incident-triage") {
    return (
      <>
        <div className="console-inset p-3 rounded-sm">
          <p className="text-[10px] font-mono text-foreground leading-relaxed">
            This lane turns the open incident ledger into a ranked triage queue with acknowledgement, ownership, remediation, and verification posture. Leave classification blank to rank the full queue.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Classification
            </label>
            <Input
              value={draft.incidentTriageClassification}
              onChange={(event) =>
                updateDraft({ incidentTriageClassification: event.target.value })
              }
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="proof-delivery"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Queue Limit
            </label>
            <Input
              type="number"
              min="1"
              max="12"
              value={draft.incidentTriageLimit}
              onChange={(event) =>
                updateDraft({ incidentTriageLimit: event.target.value })
              }
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
        </div>
      </>
    );
  }

  if (task.type === "content-generate") {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Content Type
            </label>
            <Select value={draft.contentType} onValueChange={(value) => updateDraft({ contentType: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="readme">readme</SelectItem>
                <SelectItem value="release_notes">release_notes</SelectItem>
                <SelectItem value="operator_summary">operator_summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Length
            </label>
            <Input
              value={draft.contentLength}
              onChange={(event) => updateDraft({ contentLength: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="short"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Source Name
          </label>
          <Input
            value={draft.contentSourceName}
            onChange={(event) => updateDraft({ contentSourceName: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Source Description
          </label>
          <Textarea
            value={draft.contentSourceDescription}
            onChange={(event) => updateDraft({ contentSourceDescription: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[100px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Style
          </label>
          <Input
            value={draft.contentStyle}
            onChange={(event) => updateDraft({ contentStyle: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="technical, terse"
          />
        </div>
      </>
    );
  }

  if (task.type === "integration-workflow") {
    return (
      <>
        <div className="console-inset p-3 rounded-sm space-y-2">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Workflow Lane</p>
          <p className="text-[10px] font-mono text-foreground leading-relaxed">
            Leave steps blank to run the bounded default research - extract - normalize - verify plan, or provide shorthand lines such as
            {" "}
            <span className="font-semibold">market-research: operator console trends</span>
            {" "}
            and
            {" "}
            <span className="font-semibold">qa-verification: workflow closure</span>.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Workflow Type
          </label>
          <Input
            value={draft.workflowType}
            onChange={(event) => updateDraft({ workflowType: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Steps
          </label>
          <Textarea
            value={draft.workflowSteps}
            onChange={(event) => updateDraft({ workflowSteps: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[120px]"
            placeholder={"market-research: operator console trends\ndata-extraction: capture source structure\nnormalize-data: produce comparable records\nqa-verification: confirm workflow closure"}
          />
        </div>
      </>
    );
  }

  if (task.type === "normalize-data") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Operation Type
          </label>
          <Input
            value={draft.normalizeType}
            onChange={(event) => updateDraft({ normalizeType: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Input JSON
          </label>
          <Textarea
            value={draft.normalizeInput}
            onChange={(event) => updateDraft({ normalizeInput: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[120px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Schema JSON
          </label>
          <Textarea
            value={draft.normalizeSchema}
            onChange={(event) => updateDraft({ normalizeSchema: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
          />
        </div>
      </>
    );
  }

  if (task.type === "data-extraction") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Source Type
          </label>
          <Select
            value={draft.extractionSourceType}
            onValueChange={(value) => updateDraft({ extractionSourceType: value })}
          >
            <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inline">inline</SelectItem>
              <SelectItem value="url">url</SelectItem>
              <SelectItem value="file">file</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Source Value
          </label>
          <Textarea
            value={draft.extractionSourceValue}
            onChange={(event) => updateDraft({ extractionSourceValue: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[120px]"
            placeholder="Inline text, URL, or file path"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Schema JSON
          </label>
          <Textarea
            value={draft.extractionSchema}
            onChange={(event) => updateDraft({ extractionSchema: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
            placeholder='{"fields":["title","date"]}'
          />
        </div>
      </>
    );
  }

  if (task.type === "qa-verification") {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Target
            </label>
            <Input
              value={draft.qaTarget}
              onChange={(event) => updateDraft({ qaTarget: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Target Agent ID
            </label>
            <Input
              value={draft.qaTargetAgentId}
              onChange={(event) => updateDraft({ qaTargetAgentId: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="build-refactor-agent"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Suite
            </label>
            <Select value={draft.qaSuite} onValueChange={(value) => updateDraft({ qaSuite: value })}>
              <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smoke">smoke</SelectItem>
                <SelectItem value="integration">integration</SelectItem>
                <SelectItem value="repair-closure">repair-closure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Mode
            </label>
            <Input
              value={draft.qaMode}
              onChange={(event) => updateDraft({ qaMode: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="bounded"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Test Command
          </label>
          <Input
            value={draft.qaTestCommand}
            onChange={(event) => updateDraft({ qaTestCommand: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="npm run test:unit"
          />
        </div>
        <label className="console-inset p-3 rounded-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.qaDryRun}
            onChange={(event) => updateDraft({ qaDryRun: event.target.checked })}
          />
          <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
            Dry run
          </span>
        </label>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Constraints JSON
          </label>
          <Textarea
            value={draft.qaConstraints}
            onChange={(event) => updateDraft({ qaConstraints: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
          />
        </div>
      </>
    );
  }

  if (task.type === "release-readiness") {
    return (
      <>
        <div className="console-inset p-3 rounded-sm">
          <p className="text-[10px] font-mono text-foreground leading-relaxed">
            This lane produces a bounded go, hold, or block release posture from the latest verification, security, monitor, build, incident, approval, and proof freshness evidence.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Release Target
          </label>
          <Input
            value={draft.releaseTarget}
            onChange={(event) => updateDraft({ releaseTarget: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="main"
          />
        </div>
      </>
    );
  }

  if (task.type === "skill-audit") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Depth
          </label>
          <Select value={draft.skillAuditDepth} onValueChange={(value) => updateDraft({ skillAuditDepth: value })}>
            <SelectTrigger className="bg-panel-inset border-border font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">standard</SelectItem>
              <SelectItem value="deep">deep</SelectItem>
              <SelectItem value="supply-chain">supply-chain</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Skill IDs
          </label>
          <Textarea
            value={draft.skillAuditIds}
            onChange={(event) => updateDraft({ skillAuditIds: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[100px]"
            placeholder="workspacePatch&#10;testRunner"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Checks
          </label>
          <Textarea
            value={draft.skillAuditChecks}
            onChange={(event) => updateDraft({ skillAuditChecks: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[100px]"
            placeholder="permissions&#10;provenance"
          />
        </div>
      </>
    );
  }

  if (task.type === "rss-sweep") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            RSS Config Path
          </label>
          <Input
            value={draft.rssConfigPath}
            onChange={(event) => updateDraft({ rssConfigPath: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="../rss_filter_config.json"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Drafts Path
          </label>
          <Input
            value={draft.rssDraftsPath}
            onChange={(event) => updateDraft({ rssDraftsPath: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="../logs/reddit-drafts.jsonl"
          />
        </div>
      </>
    );
  }

  if (task.type === "agent-deploy") {
    return (
      <>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Agent Name
          </label>
          <Input
            value={draft.deployAgentName}
            onChange={(event) => updateDraft({ deployAgentName: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
            placeholder="new-agent"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Template
            </label>
            <Input
              value={draft.deployTemplate}
              onChange={(event) => updateDraft({ deployTemplate: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
              placeholder="market-research"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
              Template Path
            </label>
            <Input
              value={draft.deployTemplatePath}
              onChange={(event) => updateDraft({ deployTemplatePath: event.target.value })}
              className="bg-panel-inset border-border font-mono text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Repo Path
          </label>
          <Input
            value={draft.deployRepoPath}
            onChange={(event) => updateDraft({ deployRepoPath: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Config JSON
          </label>
          <Textarea
            value={draft.deployConfig}
            onChange={(event) => updateDraft({ deployConfig: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[110px]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-[0.12em]">
            Notes
          </label>
          <Textarea
            value={draft.deployNotes}
            onChange={(event) => updateDraft({ deployNotes: event.target.value })}
            className="bg-panel-inset border-border font-mono text-sm min-h-[90px]"
          />
        </div>
      </>
    );
  }

  return (
    <div className="console-inset p-3 rounded-sm">
      <p className="text-[10px] font-mono text-foreground leading-relaxed">
        This task is exposed by the backend but does not yet have a dedicated field renderer.
      </p>
    </div>
  );
}

export default function TasksPage() {
  const { data: catalog, isLoading } = useTaskCatalog();
  const { hasRole } = useAuth();
  const isOperator = hasRole("operator");
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory | "all">("all");
  const [selectedTask, setSelectedTask] = useState<TaskRowVM | null>(null);
  const [draft, setDraft] = useState<TaskDraftState>(DEFAULT_TASK_DRAFT);
  const triggerMutation = useTriggerTask();
  const navigate = useNavigate();
  const updateDraft = (patch: Partial<TaskDraftState>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const tasks = useMemo(() => buildTaskRows(catalog), [catalog]);
  const filteredTasks = useMemo(
    () => tasks.filter((task) => categoryFilter === "all" || task.category === categoryFilter),
    [categoryFilter, tasks],
  );
  const groupedTasks = useMemo(
    () =>
      TASK_CATEGORY_ORDER.map((category) => ({
        category,
        items: filteredTasks.filter((task) => task.category === category),
      })).filter((group) => group.items.length > 0),
    [filteredTasks],
  );
  const taskSummary = useMemo(
    () => ({
      availableNow: filteredTasks.filter((task) => task.operationalStatus === "confirmed-working").length,
      approvalGated: filteredTasks.filter((task) => task.approvalGated).length,
      partialOrExternal: filteredTasks.filter((task) =>
        ["partially-operational", "externally-dependent"].includes(task.operationalStatus),
      ).length,
    }),
    [filteredTasks],
  );
  const submissionPreviewState = useMemo(
    () => {
      if (!selectedTask) {
        return { payload: null, error: null as string | null };
      }

      try {
        return {
          payload: buildTaskPayload(selectedTask.type, draft),
          error: null,
        };
      } catch (error) {
        return {
          payload: null,
          error: error instanceof Error ? error.message : "Invalid task payload",
        };
      }
    },
    [selectedTask, draft],
  );

  useEffect(() => {
    if (!selectedTask) return;
    setDraft(DEFAULT_TASK_DRAFT);
  }, [selectedTask?.type]);

  useEffect(() => {
    const requestedTaskType = searchParams.get("openTask");
    if (!requestedTaskType || !tasks.length) return;

    const requestedTask = tasks.find((task) => task.type === requestedTaskType);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("openTask");

    if (!requestedTask) {
      setSearchParams(nextParams, { replace: true });
      toast.error(`Task shortcut "${requestedTaskType}" is no longer exposed in V1`);
      return;
    }

    if (!isOperator) {
      setSearchParams(nextParams, { replace: true });
      toast.error("Operator role required to open task execution shortcuts");
      return;
    }

    setSelectedTask(requestedTask);
    setSearchParams(nextParams, { replace: true });
  }, [isOperator, searchParams, setSearchParams, tasks]);

  const closeTaskDialog = () => {
    setSelectedTask(null);
    if (searchParams.has("openTask")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("openTask");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleRun = (task: TaskRowVM) => {
    if (!isOperator) {
      toast.error("Operator role required to trigger tasks");
      return;
    }
    setSelectedTask(task);
  };

  const handleSubmit = () => {
    if (!selectedTask) return;
    try {
      const payload = buildTaskPayload(selectedTask.type, draft);
      triggerMutation.mutate(
        { type: selectedTask.type, payload },
        {
          onSuccess: (res) => {
            toast.success(`Task queued — ID: ${res.taskId}`);
            closeTaskDialog();
          },
          onError: (err: any) => {
            toast.error(err?.body?.error || err.message || "Failed to trigger task");
          },
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid task payload");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <h2 className="page-title">Tasks</h2>
        <div className="grid gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="console-panel h-24 animate-pulse" style={{ opacity: 0.3 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScrollReveal variant="fade-up">
        <h2 className="page-title">Tasks</h2>
      </ScrollReveal>

      <ScrollReveal variant="fade-up" delay={80}>
        <div className="flex items-center justify-between gap-3">
          <div className="console-inset p-3 flex-1">
            <p className="text-[11px] text-muted-foreground font-mono tracking-wide">
              <Zap className="w-3 h-3 inline mr-1.5 text-primary" />
              Bounded operator-safe launcher. Every card shows runtime posture, dependency pressure, and whether the action needs approval.
            </p>
          </div>
          <button
            onClick={() => navigate("/task-runs")}
            className="ml-0 sm:ml-3 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors shrink-0"
          >
            <History className="w-3 h-3" />
            Run History →
          </button>
        </div>
      </ScrollReveal>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{filteredTasks.length}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Visible Tasks</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{taskSummary.availableNow}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Available Now</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{taskSummary.approvalGated}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Require Approval</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{taskSummary.partialOrExternal}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Dependency Sensitive</p>
        </div>
      </div>

      <SummaryCard
        title="Task Category Filter"
        icon={<Play className="w-4 h-4" />}
        variant="inset"
      >
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
            Launch work by operator intent, not by backend implementation detail.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={categoryFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter("all")}
              className="font-mono text-[10px] uppercase tracking-wider"
            >
              All Categories
            </Button>
            {TASK_CATEGORY_ORDER.map((category) => (
              <Button
                key={category}
                variant={categoryFilter === category ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(category)}
                className="font-mono text-[10px] uppercase tracking-wider"
              >
                {category}
              </Button>
            ))}
          </div>
        </div>
      </SummaryCard>

      {groupedTasks.map((group, groupIndex) => (
        <div key={group.category} className="space-y-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] font-mono text-primary uppercase tracking-[0.16em]">{group.category}</p>
              <p className="text-[11px] font-mono text-muted-foreground mt-1">{TASK_CATEGORY_COPY[group.category]}</p>
            </div>
            <span className="activity-cell px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              {group.items.length} task{group.items.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((task, index) => (
              <ScrollReveal key={task.type} variant="mechanical" delay={120 + groupIndex * 80 + index * 40}>
                <TaskBentoCard
                  task={task}
                  isOperator={isOperator}
                  isPending={triggerMutation.isPending}
                  onRun={handleRun}
                />
              </ScrollReveal>
            ))}
          </div>
        </div>
      ))}

      {filteredTasks.length === 0 && (
        <div className="console-inset p-6 text-center">
          <p className="text-sm text-muted-foreground font-mono">
            No tasks match this category filter right now.
          </p>
        </div>
      )}

      {/* Task Trigger Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && closeTaskDialog()}>
        <DialogContent className="console-panel border-border/60 w-[min(96vw,72rem)] max-w-[72rem] gap-0 p-0" style={{
          background: 'linear-gradient(180deg, hsl(216, 14%, 12%) 0%, hsl(216, 16%, 9%) 100%)',
          boxShadow: '0 8px 32px hsl(216, 18%, 3% / 0.8), 0 0 0 1px hsl(216, 10%, 18%)',
        }}>
          <DialogHeader className="border-b border-border/40 px-6 pb-4 pt-6 pr-14">
            <DialogTitle className="font-mono text-sm uppercase tracking-wider">{selectedTask?.label}</DialogTitle>
            <DialogDescription className="text-xs">{selectedTask?.purpose}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-6 py-5 space-y-4">
            <div className="console-inset p-3 text-[10px] font-mono text-muted-foreground">
              Task type: <span className="text-foreground font-bold">{selectedTask?.type}</span>
            </div>

            <div className="console-inset p-3 rounded-sm">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Execution Path</p>
              <p className="mt-2 text-[10px] font-mono text-foreground leading-relaxed">
                {selectedTask ? buildExecutionPathCopy(selectedTask, draft) : "Select a task to see its execution path."}
              </p>
            </div>

            <div className="console-inset p-3 rounded-sm">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">What To Do Next</p>
              <p className="mt-2 text-[10px] font-mono text-foreground leading-relaxed">
                {selectedTask ? buildNextStepCopy(selectedTask, draft) : "Select a task to see the operator next-step guidance."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Category</p>
                <p className="mt-2 text-[10px] font-mono text-foreground">{selectedTask?.category}</p>
              </div>
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Dependency Class</p>
                <p className="mt-2 text-[10px] font-mono text-foreground">{selectedTask?.dependencyClass}</p>
              </div>
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Confidence</p>
                <p className="mt-2 text-[10px] font-mono text-foreground">{selectedTask?.baselineConfidence}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge label={selectedTask?.operationalStatus ?? "unknown"} />
              {selectedTask?.approvalGated && (
                <span className="text-[9px] text-status-approval font-mono uppercase tracking-[0.1em] flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Approval Required
                </span>
              )}
              {selectedTask?.availabilityLabel && (
                <span className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-primary">
                  {selectedTask.availabilityLabel}
                </span>
              )}
            </div>

            {selectedTask?.approvalGated && (
              <div className="warning-banner">
                <AlertTriangle className="w-4 h-4 text-status-approval shrink-0" />
                <p className="text-[11px] text-status-approval font-mono tracking-wide">
                  This task requires operator approval before execution.
                </p>
              </div>
            )}

            {selectedTask?.dependencyRequirements.length ? (
              <div className="console-inset p-3 rounded-sm space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Dependencies</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTask.dependencyRequirements.map((item) => (
                    <span
                      key={item}
                      className="activity-cell px-2 py-1 text-[9px] font-mono text-muted-foreground uppercase tracking-wide"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedTask?.caveats.length ? (
              <div className="console-inset p-3 rounded-sm space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Caveats</p>
                <div className="space-y-1.5">
                  {selectedTask.caveats.map((item) => (
                    <p key={item} className="text-[10px] font-mono text-foreground leading-relaxed">
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedTask && <div className="space-y-3">{renderTaskFields(selectedTask, draft, updateDraft)}</div>}

            {submissionPreviewState.error && (
              <div className="warning-banner">
                <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
                <p className="text-[11px] text-status-warning font-mono tracking-wide">
                  {submissionPreviewState.error}
                </p>
              </div>
            )}

            {submissionPreviewState.payload && (
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.12em] mb-1.5">Submission Preview</p>
                <JsonRenderer data={submissionPreviewState.payload} maxHeight="180px" />
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-border/40 px-6 py-4" style={{
            background: 'linear-gradient(180deg, hsl(216, 14%, 11%) 0%, hsl(216, 16%, 8%) 100%)',
          }}>
            <Button variant="ghost" onClick={closeTaskDialog} className="font-mono text-xs uppercase tracking-wider">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={triggerMutation.isPending}
              className="font-mono text-xs uppercase tracking-wider"
            >
              {triggerMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3 h-3 mr-1.5" />
              )}
              {selectedTask?.approvalGated ? "Submit for Approval" : "Execute Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
