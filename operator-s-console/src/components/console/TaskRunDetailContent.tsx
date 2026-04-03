import { StatusBadge } from "@/components/console/StatusBadge";
import { JsonRenderer } from "@/components/console/JsonRenderer";
import { RunRowVM, buildTimelineEvents } from "@/lib/task-runs";
import { WorkflowGraphRail } from "@/components/console/WorkflowGraphRail";
import { Loader2, AlertTriangle } from "lucide-react";
import { str, toArray, toNullableString } from "@/lib/safe-render";
import { useMemo } from "react";

interface OperatorSignalCardVM {
  id: string;
  title: string;
  status: string;
  summary: string;
  details: string[];
}

interface OperatorSignalDeckVM {
  title: string;
  summary: string;
  cards: OperatorSignalCardVM[];
}

function TimelineTone({ tone }: { tone: "healthy" | "warning" | "error" | "info" | "neutral" }) {
  const className =
    tone === "healthy"
      ? "bg-status-healthy"
      : tone === "warning"
        ? "bg-status-warning"
        : tone === "error"
          ? "bg-status-error"
          : tone === "info"
            ? "bg-status-info"
            : "bg-muted-foreground";

  return <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${className}`} />;
}

function buildSpecialistContractVM(runResult?: unknown) {
  const raw =
    runResult && typeof runResult === "object"
      ? (runResult as {
          operatorSummary?: unknown;
          recommendedNextActions?: unknown;
          specialistContract?: Record<string, unknown>;
        })
      : null;

  if (!raw) return null;

  const contract =
    raw.specialistContract && typeof raw.specialistContract === "object"
      ? raw.specialistContract
      : null;
  const operatorSummary = str(contract?.operatorSummary ?? raw.operatorSummary, "");
  const recommendedNextActions = toArray<string>(
    contract?.recommendedNextActions ?? raw.recommendedNextActions,
  )
    .map((entry) => str(entry, ""))
    .filter(Boolean);

  if (!operatorSummary && recommendedNextActions.length === 0 && !contract) {
    return null;
  }

  return {
    workflowStage: str(contract?.workflowStage, "runtime"),
    status: str(contract?.status, "unknown"),
    operatorSummary,
    recommendedNextActions,
  };
}

function buildKnowledgeFreshnessVM(runResult?: unknown) {
  const raw =
    runResult && typeof runResult === "object"
      ? (runResult as { knowledgeFreshness?: Record<string, unknown> })
      : null;
  const freshness =
    raw?.knowledgeFreshness && typeof raw.knowledgeFreshness === "object"
      ? raw.knowledgeFreshness
      : null;

  if (!freshness) return null;

  return {
    status: str(freshness.status, "unknown"),
    reviewRecommended: freshness.reviewRecommended === true,
    warnings: toArray<string>(freshness.warnings).map((entry) => str(entry, "")).filter(Boolean),
    packGeneratedAt: toNullableString(freshness.packGeneratedAt),
    docsLatestModifiedAt: toNullableString(freshness.docsLatestModifiedAt),
    packAgeHours:
      typeof freshness.packAgeHours === "number" ? freshness.packAgeHours : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeStringList(value: unknown, limit = 3) {
  return toArray<string>(value)
    .map((entry) => str(entry, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function compactDetails(details: Array<string | null | undefined | false>, limit = 3) {
  return details
    .filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
    .slice(0, limit);
}

function mapQaClosureStatus(allowClosure: boolean, decision: string) {
  if (allowClosure) return "ready";
  if (decision === "escalate") return "blocked";
  return "watching";
}

function mapReproducibilityStatus(value: string) {
  if (value === "verified") return "ready";
  if (value === "unproven") return "watching";
  return "blocked";
}

function mapSignalPresenceStatus(count: number, blocked = false) {
  if (blocked) return "blocked";
  return count > 0 ? "watching" : "ready";
}

function buildQaSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const closureRecommendation = asRecord(raw.closureRecommendation);
  const acceptanceCoverage = asRecord(raw.acceptanceCoverage);
  const verificationAuthority = asRecord(raw.verificationAuthority);
  const reproducibilityProfile = asRecord(raw.reproducibilityProfile);
  const closureContract = asRecord(raw.closureContract);

  if (
    !closureRecommendation &&
    !acceptanceCoverage &&
    !verificationAuthority &&
    !reproducibilityProfile &&
    !closureContract
  ) {
    return null;
  }

  const decision = str(closureRecommendation?.decision, "keep-open");
  const allowClosure = closureRecommendation?.allowClosure === true;
  const authorityLevel = str(verificationAuthority?.authorityLevel, "advisory");
  const closeAllowed = closureContract?.closeAllowed === true;
  const unresolvedSignals =
    typeof closureContract?.unresolvedSignals === "number" ? closureContract.unresolvedSignals : 0;
  const recommendedEvidence = normalizeStringList(verificationAuthority?.requiredEvidence, 2);
  const followups = normalizeStringList(closureContract?.requiredFollowups, 2);

  return {
    title: "Verification Control Deck",
    summary: "Closure, evidence, and reproducibility posture for this verification run.",
    cards: [
      {
        id: "qa-closure",
        title: "Closure Decision",
        status: mapQaClosureStatus(allowClosure, decision),
        summary: str(
          closureRecommendation?.summary,
          "No closure recommendation was recorded for this verification run.",
        ),
        details: compactDetails([
          `Authority: ${authorityLevel} for ${str(verificationAuthority?.targetKind, "workspace")}.`,
          `Coverage: ${str(acceptanceCoverage?.closureReadiness, "needs-evidence")} via ${str(
            acceptanceCoverage?.acceptanceMode,
            "evidence-review",
          )}.`,
          recommendedEvidence.length > 0
            ? `Evidence still expected: ${recommendedEvidence.join(", ")}.`
            : null,
        ]),
      },
      {
        id: "qa-reproducibility",
        title: "Reproducibility",
        status: mapReproducibilityStatus(str(reproducibilityProfile?.reproducibility, "unproven")),
        summary: `Evidence quality is ${str(
          reproducibilityProfile?.evidenceQuality,
          "minimal",
        )} with ${str(reproducibilityProfile?.regressionRisk, "unknown")} regression risk.`,
        details: compactDetails([
          `Workflow stop signals: ${str(reproducibilityProfile?.workflowStopSignals, "0")}.`,
          `Repairs referenced: ${str(reproducibilityProfile?.repairCount, "0")} · relationships carried: ${str(
            reproducibilityProfile?.relationshipCount,
            "0",
          )}.`,
          `Priority incidents in scope: ${str(reproducibilityProfile?.priorityIncidentCount, "0")}.`,
        ]),
      },
      {
        id: "qa-contract",
        title: "Closure Contract",
        status: closeAllowed ? "ready" : unresolvedSignals > 0 ? "blocked" : "watching",
        summary: closeAllowed
          ? "The verification contract allows closure if downstream evidence stays intact."
          : "The verification contract still carries unresolved signals or follow-up work.",
        details: compactDetails([
          `Target: ${str(closureContract?.targetKind, "workspace")} ${str(
            closureContract?.targetId,
            "pending",
          )}.`,
          `Reopen on failure: ${closureContract?.reopenOnFailure === true ? "yes" : "no"} · unresolved signals: ${unresolvedSignals}.`,
          followups.length > 0 ? `Follow-ups: ${followups.join(", ")}.` : null,
        ]),
      },
    ],
  };
}

function buildSecuritySignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const remediationClosure = asRecord(raw.remediationClosure);
  const regressionReview = asRecord(raw.regressionReview);
  const remediationDepth = asRecord(raw.remediationDepth);
  const routeBoundaryWatch = asRecord(raw.routeBoundaryWatch);
  const exploitabilityRanking = toArray<Record<string, unknown>>(raw.exploitabilityRanking);

  if (
    !remediationClosure &&
    !regressionReview &&
    !remediationDepth &&
    !routeBoundaryWatch &&
    exploitabilityRanking.length === 0
  ) {
    return null;
  }

  const topExploitability = exploitabilityRanking[0];
  const closureBlockers = normalizeStringList(remediationClosure?.closureBlockers, 2);

  return {
    title: "Security Closure Deck",
    summary: "Trust-boundary closure, exploitability ranking, and remediation depth for this audit.",
    cards: [
      {
        id: "security-closure",
        title: "Remediation Closure",
        status: str(remediationClosure?.status, "watching"),
        summary: `High-risk findings: ${str(remediationClosure?.highRiskCount, "0")} · ownerless priorities: ${str(
          remediationClosure?.ownerlessPriorityCount,
          "0",
        )}.`,
        details: compactDetails([
          `Verifier recommended: ${remediationClosure?.verifierRecommended === true ? "yes" : "no"}.`,
          closureBlockers.length > 0 ? `Blockers: ${closureBlockers.join(", ")}.` : null,
        ]),
      },
      {
        id: "security-exploitability",
        title: "Exploitability Ranking",
        status: exploitabilityRanking.length > 0 ? "watching" : "ready",
        summary: topExploitability
          ? `${str(topExploitability.severity, "HIGH")} finding ${str(
              topExploitability.findingId,
              "finding",
            )} leads the queue at ${str(topExploitability.location, "unknown location")}.`
          : "No exploitability ranking was emitted for this run.",
        details: compactDetails([
          topExploitability
            ? `Top boundary: ${str(topExploitability.trustBoundary, "general")} · combined score ${str(
                topExploitability.combinedScore,
                "0",
              )}.`
            : null,
          topExploitability
            ? `Containment: ${str(topExploitability.containment, "No containment guidance recorded.")}.`
            : null,
          exploitabilityRanking.length > 1
            ? `${exploitabilityRanking.length - 1} more ranked finding(s) remain in the review queue.`
            : null,
        ]),
      },
      {
        id: "security-regression",
        title: "Regression Review",
        status: str(regressionReview?.status, "watching"),
        summary: `Permission drift incidents: ${str(
          regressionReview?.permissionDriftCount,
          "0",
        )} · recurring boundary incidents: ${str(regressionReview?.recurringBoundaryCount, "0")}.`,
        details: compactDetails([
          `Rollback-ready fixes: ${str(regressionReview?.rollbackReadyFixCount, "0")}.`,
          routeBoundaryWatch
            ? `Route boundary watch is ${str(routeBoundaryWatch.status, "nominal")} with ${str(
                routeBoundaryWatch.unprotectedRouteCount,
                "0",
              )} unprotected route(s).`
            : null,
          remediationDepth
            ? `Remediation depth is ${str(remediationDepth.status, "watching")} with ${str(
                remediationDepth.rollbackSensitiveFixCount,
                "0",
              )} rollback-sensitive fix(es).`
            : null,
        ]),
      },
    ],
  };
}

function buildSystemMonitorSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const operationalDiagnosis = asRecord(raw.operationalDiagnosis);
  const dependencyHealth = asRecord(raw.dependencyHealth);
  const operatorClosureEvidence = asRecord(raw.operatorClosureEvidence);
  const operatorActions = toArray<Record<string, unknown>>(raw.operatorActions);
  const earlyWarnings = toArray<Record<string, unknown>>(raw.earlyWarnings);

  if (
    !operationalDiagnosis &&
    !dependencyHealth &&
    !operatorClosureEvidence &&
    operatorActions.length === 0 &&
    earlyWarnings.length === 0
  ) {
    return null;
  }

  const topAction = operatorActions[0];
  const topWarning = earlyWarnings[0];

  return {
    title: "Monitoring Control Deck",
    summary: "Operational diagnosis, dependency health, and closure-readiness guidance for this runtime pass.",
    cards: [
      {
        id: "monitor-diagnosis",
        title: "Operational Diagnosis",
        status: str(operationalDiagnosis?.status, "watching"),
        summary: `Dominant risk: ${str(operationalDiagnosis?.dominantRisk, "none recorded")} · ${str(
          operationalDiagnosis?.diagnosisCount,
          "0",
        )} diagnosis item(s) active.`,
        details: compactDetails([
          `Dependency health: ${str(operationalDiagnosis?.dependencyStatus, str(dependencyHealth?.status, "healthy"))}.`,
          `Trust boundary posture: ${str(operationalDiagnosis?.trustBoundaryStatus, "nominal")} · budget posture: ${str(
            operationalDiagnosis?.budgetStatus,
            "unknown",
          )}.`,
          `Prioritized operator actions: ${str(operationalDiagnosis?.operatorActionCount, "0")} · remediation queue depth: ${str(
            operationalDiagnosis?.remediationQueueDepth,
            "0",
          )}.`,
        ]),
      },
      {
        id: "monitor-actions",
        title: "Operator Actions",
        status: mapSignalPresenceStatus(
          operatorActions.length,
          str(topAction?.priority, "") === "critical",
        ),
        summary: topAction
          ? str(topAction.summary, "No operator action summary recorded.")
          : "No prioritized operator actions were emitted for this monitoring pass.",
        details: compactDetails([
          topAction ? `Highest priority owner: ${str(topAction.owner, "operator")}.` : null,
          topWarning
            ? `Nearest warning: ${str(topWarning.summary, "warning")} → ${str(
                topWarning.predictedImpact,
                "impact not recorded",
              )}.`
            : null,
          operatorActions.length > 1
            ? `${operatorActions.length - 1} more action(s) remain in the queue.`
            : null,
        ]),
      },
      {
        id: "monitor-closure",
        title: "Closure Readiness",
        status: str(operatorClosureEvidence?.status, "watching"),
        summary: `Open critical incidents: ${str(
          operatorClosureEvidence?.openCriticalIncidents,
          "0",
        )} · verifier-sensitive incidents: ${str(operatorClosureEvidence?.verifierSensitiveIncidents, "0")}.`,
        details: compactDetails([
          `Ownerless incidents: ${str(operatorClosureEvidence?.ownerlessIncidents, "0")} · proof freshness: ${str(
            operatorClosureEvidence?.proofFreshness,
            "empty",
          )}.`,
          dependencyHealth
            ? `Blocked workflows: ${str(dependencyHealth.blockedWorkflowCount, "0")} · retry recoveries: ${str(
                dependencyHealth.retryRecoveryCount,
                "0",
              )}.`
            : null,
        ]),
      },
    ],
  };
}

function buildSkillAuditSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const trustPosture = asRecord(raw.trustPosture);
  const policyHandoff = asRecord(raw.policyHandoff);
  const telemetryHandoff = asRecord(raw.telemetryHandoff);
  const restartSafetySummary = asRecord(raw.restartSafetySummary);

  if (!trustPosture && !policyHandoff && !telemetryHandoff && !restartSafetySummary) {
    return null;
  }

  const pendingReviewSkills = normalizeStringList(policyHandoff?.pendingReviewSkills, 3);
  const metadataOnlySkills = normalizeStringList(policyHandoff?.metadataOnlySkills, 2);
  const riskySkillIds = normalizeStringList(telemetryHandoff?.riskySkillIds, 2);
  const missingSkillIds = normalizeStringList(telemetryHandoff?.missingSkillIds, 2);

  return {
    title: "Governance Adoption Deck",
    summary: "Trust posture, policy handoff, telemetry pressure, and restart safety for this audit.",
    cards: [
      {
        id: "skill-trust",
        title: "Trust Posture",
        status: str(trustPosture?.status, "watching"),
        summary: `Pending review: ${str(trustPosture?.pendingReviewCount, "0")} · approved: ${str(
          trustPosture?.approvedCount,
          "0",
        )}.`,
        details: compactDetails([
          `Restart-safe approved: ${str(trustPosture?.restartSafeApprovedCount, "0")} · metadata-only: ${str(
            trustPosture?.metadataOnlyCount,
            "0",
          )}.`,
          `Missing registry entries: ${str(trustPosture?.missingRegistryCount, "0")}.`,
        ]),
      },
      {
        id: "skill-policy",
        title: "Policy Handoff",
        status: str(policyHandoff?.status, "clear"),
        summary:
          pendingReviewSkills.length > 0
            ? `Pending review skills: ${pendingReviewSkills.join(", ")}.`
            : "No pending-review skills are blocking policy handoff.",
        details: compactDetails([
          metadataOnlySkills.length > 0
            ? `Metadata-only skills: ${metadataOnlySkills.join(", ")}.`
            : null,
        ]),
      },
      {
        id: "skill-telemetry",
        title: "Telemetry Handoff",
        status:
          str(telemetryHandoff?.status, "quiet") === "alert"
            ? "blocked"
            : str(telemetryHandoff?.status, "quiet") === "watch"
              ? "watching"
              : "ready",
        summary:
          riskySkillIds.length > 0
            ? `Risky skill activity surfaced for ${riskySkillIds.join(", ")}.`
            : "No risky governed skill telemetry needs intervention right now.",
        details: compactDetails([
          missingSkillIds.length > 0
            ? `Missing telemetry coverage: ${missingSkillIds.join(", ")}.`
            : null,
        ]),
      },
      {
        id: "skill-restart",
        title: "Restart Safety",
        status: str(restartSafetySummary?.status, "stable"),
        summary: `Restart-safe skills: ${str(
          restartSafetySummary?.restartSafeCount,
          "0",
        )} · needs review: ${str(restartSafetySummary?.needsReviewCount, "0")}.`,
        details: compactDetails([
          `Executable approved: ${str(restartSafetySummary?.executableApprovedCount, "0")} · pending review: ${str(
            restartSafetySummary?.pendingReviewCount,
            "0",
          )}.`,
        ]),
      },
    ],
  };
}

function mapDocRepairStatus(value: string) {
  if (value === "clear") return "ready";
  if (value === "repair-needed") return "blocked";
  return "watching";
}

function mapPublicationPolicyStatus(value: string) {
  if (value === "grounded") return "ready";
  if (value === "speculative-refused") return "blocked";
  return "watching";
}

function mapEvidencePreservationStatus(value: string) {
  if (value === "preserved") return "ready";
  if (value === "missing") return "blocked";
  return "watching";
}

function mapDeltaCaptureStatus(value: string) {
  if (value === "fetched") return "ready";
  return "watching";
}

function buildIntegrationSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const plan = asRecord(raw.plan);
  const workflowProfile = asRecord(plan?.workflowProfile);
  const dependencyPlan = asRecord(raw.dependencyPlan);
  const workflowMemory = asRecord(raw.workflowMemory);
  const partialCompletion = asRecord(raw.partialCompletion);
  const recoveryPlan = asRecord(raw.recoveryPlan);
  const handoffPackages = toArray<Record<string, unknown>>(raw.handoffPackages);

  if (
    !plan &&
    !workflowProfile &&
    !dependencyPlan &&
    !workflowMemory &&
    !partialCompletion &&
    !recoveryPlan &&
    handoffPackages.length === 0
  ) {
    return null;
  }

  const criticalPath = normalizeStringList(workflowProfile?.criticalPath, 3);
  const coordinationRisks = normalizeStringList(workflowProfile?.coordinationRisks, 2);
  const criticalStep = toArray<Record<string, unknown>>(dependencyPlan?.criticalSteps)[0];
  const topHandoff = handoffPackages[0];
  const verificationHandoff = asRecord(recoveryPlan?.verificationHandoff);
  const remainingSteps = toArray<string>(partialCompletion?.remainingSteps).length;

  return {
    title: "Workflow Coordination Deck",
    summary: "Workflow profile, dependency pressure, and replay posture for this conductor run.",
    cards: [
      {
        id: "integration-profile",
        title: "Workflow Profile",
        status:
          toNullableString(partialCompletion?.blockedStep) !== null
            ? "blocked"
            : workflowProfile?.verifierRequired === true || coordinationRisks.length > 0
              ? "watching"
              : "ready",
        summary: `Classification ${str(workflowProfile?.classification, "mixed")} over ${str(
          workflowProfile?.dominantSurface,
          "runtime",
        )} with ${str(plan?.readySteps, "0")} ready and ${str(plan?.blockedSteps, "0")} blocked step(s).`,
        details: compactDetails([
          criticalPath.length > 0 ? `Critical path: ${criticalPath.join(" -> ")}.` : null,
          coordinationRisks.length > 0 ? `Coordination risks: ${coordinationRisks.join(", ")}.` : null,
          `Verifier handoff required: ${workflowProfile?.verifierRequired === true ? "yes" : "no"}.`,
        ]),
      },
      {
        id: "integration-dependencies",
        title: "Dependency Plan",
        status:
          Number(dependencyPlan?.blockedDependencyCount ?? 0) > 0
            ? "blocked"
            : Number(dependencyPlan?.sharedDependencyCount ?? 0) > 0
              ? "watching"
              : "ready",
        summary: `Dependencies: ${str(dependencyPlan?.totalDependencies, "0")} total with ${str(
          dependencyPlan?.sharedDependencyCount,
          "0",
        )} shared and ${str(dependencyPlan?.blockedDependencyCount, "0")} blocked.`,
        details: compactDetails([
          criticalStep
            ? `Top critical step: ${str(criticalStep.step, "step")} on ${str(
                criticalStep.surface,
                "runtime",
              )} via ${str(criticalStep.selectedAgent, "unassigned")}.`
            : null,
          criticalStep
            ? `Depends on ${normalizeStringList(criticalStep.dependsOn, 3).join(", ") || "no explicit dependencies"}.`
            : null,
          criticalStep
            ? `Blockers: ${normalizeStringList(criticalStep.blockers, 2).join(", ") || "none recorded"}.`
            : null,
        ]),
      },
      {
        id: "integration-replay",
        title: "Replay And Handoff",
        status:
          remainingSteps > 0 || handoffPackages.length > 0 || Number(workflowMemory?.recentStopSignals ?? 0) > 0
            ? "watching"
            : "ready",
        summary:
          topHandoff
            ? `Top handoff routes ${str(topHandoff.payloadType, "workflow-replay")} to ${str(
                topHandoff.targetAgentId,
                "next-agent",
              )}.`
            : "No downstream handoff package was required for this workflow.",
        details: compactDetails([
          `Replayable: ${partialCompletion?.replayable === true ? "yes" : "no"} · remaining steps: ${remainingSteps}.`,
          `Reroute count: ${str(partialCompletion?.rerouteCount, "0")} · recent stop signals: ${str(
            workflowMemory?.recentStopSignals,
            "0",
          )}.`,
          verificationHandoff ? `Verifier handoff: ${str(verificationHandoff.reason, "No verifier reason recorded.")}` : null,
        ]),
      },
    ],
  };
}

function buildBuildRefactorSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const scopeContract = asRecord(raw.scopeContract);
  const surgeryProfile = asRecord(raw.surgeryProfile);
  const verificationLoop = asRecord(raw.verificationLoop);
  const impactEnvelope = asRecord(raw.impactEnvelope);
  const refusalProfile = asRecord(raw.refusalProfile);
  const summary = asRecord(raw.summary);

  if (!scopeContract && !surgeryProfile && !verificationLoop && !impactEnvelope && !refusalProfile && !summary) {
    return null;
  }

  return {
    title: "Refactor Control Deck",
    summary: "Scope, surgery, verification, and rollback posture for this bounded code run.",
    cards: [
      {
        id: "refactor-scope",
        title: "Scope Contract",
        status:
          refusalProfile?.refused === true
            ? "refused"
            : scopeContract?.bounded === true
              ? "ready"
              : "watching",
        summary: `Scope is ${str(scopeContract?.scopeType, "bounded")} with ${str(
          scopeContract?.estimatedTouchedFiles,
          "0",
        )} estimated touched file(s).`,
        details: compactDetails([
          `Requested max files: ${str(scopeContract?.requestedMaxFilesChanged, "none")}.`,
          normalizeStringList(scopeContract?.refusalReasons, 2).length > 0
            ? `Scope concerns: ${normalizeStringList(scopeContract?.refusalReasons, 2).join(", ")}.`
            : null,
          refusalProfile?.narrowScopeSuggested === true
            ? `Suggested max files changed: ${str(refusalProfile?.suggestedMaxFilesChanged, "n/a")}.`
            : null,
        ]),
      },
      {
        id: "refactor-surgery",
        title: "Surgery Profile",
        status:
          surgeryProfile?.rollbackSensitive === true
            ? "watching"
            : surgeryProfile?.qaVerificationRequired === true
              ? "verification-required"
              : "ready",
        summary: `Change type ${str(surgeryProfile?.changeType, "bounded")} touches ${normalizeStringList(
          surgeryProfile?.affectedSurfaces,
          3,
        ).join(", ") || "repo-local surfaces"}.`,
        details: compactDetails([
          `QA verification required: ${surgeryProfile?.qaVerificationRequired === true ? "yes" : "no"}.`,
          `Rollback sensitive: ${surgeryProfile?.rollbackSensitive === true ? "yes" : "no"}.`,
          str(surgeryProfile?.operatorReviewReason, "") || null,
        ]),
      },
      {
        id: "refactor-verification",
        title: "Verification And Rollback",
        status:
          summary?.testsPass === false
            ? "blocked"
            : verificationLoop?.requiresVerifier === true
              ? "verification-required"
              : impactEnvelope?.rollbackWindow === "tight"
                ? "watching"
                : "ready",
        summary:
          summary?.testsPass === false
            ? "Verification did not stay green after the bounded surgery."
            : `Verification depth is ${str(impactEnvelope?.verificationDepth, "advisory")} with rollback window ${str(
                impactEnvelope?.rollbackWindow,
                "standard",
              )}.`,
        details: compactDetails([
          `Files changed: ${str(summary?.filesChanged, "0")} · lines changed: ${str(summary?.linesChanged, "0")}.`,
          normalizeStringList(verificationLoop?.postEditSteps, 3).length > 0
            ? `Post-edit steps: ${normalizeStringList(verificationLoop?.postEditSteps, 3).join(", ")}.`
            : null,
          `Verifier required: ${verificationLoop?.requiresVerifier === true ? "yes" : "no"} · repair linked: ${str(
            verificationLoop?.mode,
            "standard",
          )}.`,
        ]),
      },
    ],
  };
}

function buildDocSpecialistSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const contradictionLedger = toArray<Record<string, unknown>>(raw.contradictionLedger);
  const repairDrafts = toArray<Record<string, unknown>>(raw.repairDrafts);
  const topologyPacks = toArray<Record<string, unknown>>(raw.topologyPacks);
  const taskSpecificKnowledge = toArray<Record<string, unknown>>(raw.taskSpecificKnowledge);
  const entityFreshnessLedger = toArray<Record<string, unknown>>(raw.entityFreshnessLedger);
  const contradictionGraph = asRecord(raw.contradictionGraph);
  const repairLoop = asRecord(raw.repairLoop);

  if (
    contradictionLedger.length === 0 &&
    repairDrafts.length === 0 &&
    topologyPacks.length === 0 &&
    taskSpecificKnowledge.length === 0 &&
    entityFreshnessLedger.length === 0 &&
    !contradictionGraph &&
    !repairLoop
  ) {
    return null;
  }

  const staleEntityCount = entityFreshnessLedger.filter(
    (entry) => str(entry.freshness, "unknown") === "stale",
  ).length;
  const topRepairDraft = repairDrafts[0];
  const topRepairDraftHandoff = asRecord(topRepairDraft?.handoff);

  return {
    title: "Knowledge Repair Deck",
    summary: "Contradiction review, repair guidance, and freshness coverage for this knowledge pack refresh.",
    cards: [
      {
        id: "doc-contradictions",
        title: "Contradiction Review",
        status: contradictionLedger.length > 0 ? "watching" : "ready",
        summary: `Ranked contradictions: ${contradictionLedger.length} across ${str(
          contradictionGraph?.entityCount,
          "0",
        )} entity(ies).`,
        details: compactDetails([
          `Ranked contradiction count: ${str(contradictionGraph?.rankedContradictionCount, "0")}.`,
          contradictionLedger[0] ? str(contradictionLedger[0].summary, "") || null : null,
          staleEntityCount > 0 ? `${staleEntityCount} entity freshness record(s) are stale.` : null,
        ]),
      },
      {
        id: "doc-repair",
        title: "Repair Loop",
        status: mapDocRepairStatus(str(repairLoop?.status, "watching")),
        summary: `Repair loop is ${str(repairLoop?.status, "watching")} with recommended task ${str(
          repairLoop?.recommendedTaskType,
          "qa-verification",
        )}.`,
        details: compactDetails([
          topRepairDraft
            ? `Top draft routes ${str(topRepairDraftHandoff?.recommendedTaskType, "qa-verification")} for ${str(
                topRepairDraft.targetAgentId,
                "target-agent",
              )}.`
            : null,
          normalizeStringList(repairLoop?.nextActions, 1)[0] ?? null,
          normalizeStringList(repairLoop?.staleSignals, 1)[0] ?? null,
        ]),
      },
      {
        id: "doc-coverage",
        title: "Knowledge Coverage",
        status: staleEntityCount > 0 ? "watching" : "ready",
        summary: `Topology packs: ${topologyPacks.length} · task-specific bundles: ${taskSpecificKnowledge.length} · freshness entries: ${entityFreshnessLedger.length}.`,
        details: compactDetails([
          taskSpecificKnowledge[0]
            ? `Top target bundle: ${str(taskSpecificKnowledge[0].targetAgentId, "target-agent")}.`
            : null,
          topologyPacks[0]
            ? `Top topology pack routes ${str(topologyPacks[0].targetAgentId, "target-agent")} via ${str(
                topologyPacks[0].routeTaskType,
                "n/a",
              )}.`
            : null,
        ]),
      },
    ],
  };
}

function buildContentSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const publicationPolicy = asRecord(raw.publicationPolicy);
  const claimDiscipline = asRecord(raw.claimDiscipline);
  const routingDecision = asRecord(raw.routingDecision);
  const handoffPackage = asRecord(raw.handoffPackage);
  const evidenceSchema = asRecord(raw.evidenceSchema);
  const documentSpecialization = asRecord(raw.documentSpecialization);

  if (!publicationPolicy && !claimDiscipline && !routingDecision && !handoffPackage && !evidenceSchema && !documentSpecialization) {
    return null;
  }

  return {
    title: "Publishing Control Deck",
    summary: "Publication policy, routing, and evidence posture for this grounded content draft.",
    cards: [
      {
        id: "content-policy",
        title: "Publication Policy",
        status: mapPublicationPolicyStatus(str(publicationPolicy?.status, "grounded")),
        summary: `Policy is ${str(publicationPolicy?.status, "grounded")} with ${str(
          claimDiscipline?.groundedClaims,
          "0",
        )} grounded claim(s).`,
        details: compactDetails([
          Number(toArray<string>(claimDiscipline?.speculativeClaims).length) > 0
            ? `Speculative claims: ${normalizeStringList(claimDiscipline?.speculativeClaims, 2).join(", ")}.`
            : null,
          str(publicationPolicy?.rationale, "") || null,
        ]),
      },
      {
        id: "content-routing",
        title: "Routing Decision",
        status: routingDecision?.escalationRequired === true ? "blocked" : "ready",
        summary: `Audience ${str(routingDecision?.audience, "general")} in ${str(
          routingDecision?.documentMode,
          "general",
        )} mode routes to ${str(routingDecision?.downstreamAgent, "next-agent")}.`,
        details: compactDetails([
          documentSpecialization
            ? `Document mode: ${str(documentSpecialization.mode, "general")} with ${str(
                documentSpecialization.riskLevel,
                "low",
              )} risk.`
            : null,
          routingDecision?.escalationRequired === true
            ? "Operator review is still required before broadening this draft."
            : null,
        ]),
      },
      {
        id: "content-evidence",
        title: "Evidence And Handoff",
        status: evidenceSchema?.evidenceAttached === true ? "ready" : "watching",
        summary: `Evidence rails: ${normalizeStringList(evidenceSchema?.rails, 3).join(", ") || "none recorded"} with ${str(
          evidenceSchema?.sourceSummaryCount,
          "0",
        )} source summary block(s).`,
        details: compactDetails([
          handoffPackage
            ? `Handoff target: ${str(handoffPackage.targetAgentId, "next-agent")} via ${str(
                handoffPackage.payloadType,
                "publication-summary",
              )}.`
            : null,
          handoffPackage ? str(handoffPackage.reason, "") || null : null,
        ]),
      },
    ],
  };
}

function buildSummarizationSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const evidencePreservation = asRecord(raw.evidencePreservation);
  const handoff = asRecord(raw.handoff);
  const handoffPackage = asRecord(raw.handoffPackage);
  const operationalCompression = asRecord(raw.operationalCompression);
  const actionCriticalDetails = asRecord(raw.actionCriticalDetails);
  const downstreamArtifact = asRecord(raw.downstreamArtifact);

  if (!evidencePreservation && !handoff && !handoffPackage && !operationalCompression && !actionCriticalDetails && !downstreamArtifact) {
    return null;
  }

  const blockers = normalizeStringList(actionCriticalDetails?.blockers, 2);
  const nextActions = normalizeStringList(actionCriticalDetails?.nextActions, 2);

  return {
    title: "Compression Handoff Deck",
    summary: "Anchor retention, delegation readiness, and downstream artifact posture for this summary.",
    cards: [
      {
        id: "summary-preservation",
        title: "Evidence Preservation",
        status: mapEvidencePreservationStatus(str(evidencePreservation?.status, "partial")),
        summary: `Anchors retained: ${str(evidencePreservation?.anchorsRetained, "0")} of ${str(
          evidencePreservation?.anchorsDetected,
          "0",
        )} detected.`,
        details: compactDetails([
          `Compression mode: ${str(operationalCompression?.mode, "general")} at ${str(
            operationalCompression?.anchorRetentionRatio,
            "0",
          )} retention ratio.`,
        ]),
      },
      {
        id: "summary-handoff",
        title: "Handoff Readiness",
        status:
          handoff?.readyForDelegation === true && operationalCompression?.blockerSafe !== false
            ? "ready"
            : "watching",
        summary: `Delegation mode ${str(handoff?.mode, "general")} targets ${str(
          handoffPackage?.targetAgentId,
          "next-agent",
        )} via ${str(handoffPackage?.payloadType, "operator-handoff")}.`,
        details: compactDetails([
          `Downstream target: ${str(operationalCompression?.downstreamTarget, "next-agent")}.`,
          `Blocker safe: ${operationalCompression?.blockerSafe === true ? "yes" : "no"}.`,
        ]),
      },
      {
        id: "summary-action",
        title: "Action-Critical Details",
        status: blockers.length > 0 ? "watching" : "ready",
        summary:
          nextActions[0] ??
          "No action-critical next step was emitted for this summary.",
        details: compactDetails([
          blockers.length > 0 ? `Blockers: ${blockers.join(", ")}.` : null,
          downstreamArtifact
            ? `Artifact: ${str(downstreamArtifact.artifactType, "handoff-summary")} with ${str(
                downstreamArtifact.replayAnchorCount,
                "0",
              )} replay anchor(s).`
            : null,
        ]),
      },
    ],
  };
}

function buildRedditSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const replyVerification = asRecord(raw.replyVerification);
  const explanationBoundary = asRecord(raw.explanationBoundary);
  const providerPosture = asRecord(raw.providerPosture);
  const communitySignalRouting = asRecord(raw.communitySignalRouting);

  if (!replyVerification && !explanationBoundary && !providerPosture && !communitySignalRouting) {
    return null;
  }

  const handoffs = toArray<Record<string, unknown>>(communitySignalRouting?.handoffs);
  const doctrineApplied = normalizeStringList(replyVerification?.doctrineApplied, 3);
  const topHandoff = handoffs[0];

  return {
    title: "Community Control Deck",
    summary: "Doctrine, provider posture, and community-routing signals for this reply draft.",
    cards: [
      {
        id: "reddit-doctrine",
        title: "Reply Verification",
        status: replyVerification?.requiresReview === true ? "watching" : "ready",
        summary: `Doctrine checks applied: ${doctrineApplied.join(", ") || "none recorded"} with ${str(
          replyVerification?.anchorCount,
          "0",
        )} anchor(s).`,
        details: compactDetails([
          str(replyVerification?.reasoning, "") || null,
        ]),
      },
      {
        id: "reddit-provider",
        title: "Provider Posture",
        status:
          providerPosture?.reviewRecommended === true
            ? "watching"
            : str(providerPosture?.queuePressureStatus, "nominal") === "nominal"
              ? "ready"
              : "watching",
        summary: `Mode ${str(providerPosture?.mode, "local-only")} with queue pressure ${str(
          providerPosture?.queuePressureStatus,
          "nominal",
        )}.`,
        details: compactDetails([
          str(providerPosture?.reason, "") || null,
          `Fallback integrity: ${str(providerPosture?.fallbackIntegrity, "retained-local-doctrine")}.`,
        ]),
      },
      {
        id: "reddit-routing",
        title: "Boundary And Routing",
        status:
          str(explanationBoundary?.status, "public-safe") === "internal-only-review"
            ? "watching"
            : handoffs.length > 0
              ? "watching"
              : "ready",
        summary: `Explanation boundary is ${str(explanationBoundary?.status, "public-safe")} with ${handoffs.length} downstream handoff(s).`,
        details: compactDetails([
          topHandoff
            ? `Top handoff routes ${str(topHandoff.surface, "docs")} to ${str(
                topHandoff.targetAgentId,
                "next-agent",
              )}.`
            : null,
          topHandoff ? str(topHandoff.reason, "") || null : null,
          `Systematic routing: ${communitySignalRouting?.systematic === true ? "yes" : "no"}.`,
        ]),
      },
    ],
  };
}

function buildDataExtractionSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const artifactCoverage = asRecord(raw.artifactCoverage);
  const provenanceSummary = toArray<Record<string, unknown>>(raw.provenanceSummary);
  const handoffPackages = toArray<Record<string, unknown>>(raw.handoffPackages);

  if (!artifactCoverage && provenanceSummary.length === 0 && handoffPackages.length === 0) {
    return null;
  }

  const uniqueTargets = Array.from(
    new Set(
      handoffPackages
        .map((entry) => str(entry.targetAgentId, ""))
        .filter(Boolean),
    ),
  );
  const topHandoff = handoffPackages[0];

  return {
    title: "Extraction Handoff Deck",
    summary: "Artifact coverage, provenance depth, and downstream handoff posture for this extraction run.",
    cards: [
      {
        id: "extract-coverage",
        title: "Artifact Coverage",
        status:
          str(artifactCoverage?.provenanceDepth, "basic") === "strong" &&
          Number(artifactCoverage?.normalizationReadyCount ?? 0) > 0
            ? "ready"
            : "watching",
        summary: `Formats: ${normalizeStringList(artifactCoverage?.formats, 3).join(", ") || "mixed"} · normalization-ready sources: ${str(
          artifactCoverage?.normalizationReadyCount,
          "0",
        )}.`,
        details: compactDetails([
          `Adapter modes: ${normalizeStringList(artifactCoverage?.adapterModes, 3).join(", ") || "unknown"}.`,
          `Provenance depth: ${str(artifactCoverage?.provenanceDepth, "basic")}.`,
        ]),
      },
      {
        id: "extract-provenance",
        title: "Provenance Summary",
        status: provenanceSummary.length > 0 ? "ready" : "watching",
        summary: `Records extracted: ${str(raw.recordsExtracted, "0")} · entities found: ${str(
          raw.entitiesFound,
          "0",
        )}.`,
        details: compactDetails([
          provenanceSummary[0]
            ? `Top source: ${str(provenanceSummary[0].sourceType, "source")} in ${str(
                provenanceSummary[0].format,
                "unknown",
              )}.`
            : null,
          provenanceSummary[0] && provenanceSummary[0].extractedAt
            ? `Extracted at ${new Date(String(provenanceSummary[0].extractedAt)).toLocaleString()}.`
            : null,
        ]),
      },
      {
        id: "extract-handoff",
        title: "Normalization Handoff",
        status: uniqueTargets.length > 0 ? "ready" : "watching",
        summary:
          topHandoff
            ? `Top handoff routes ${str(topHandoff.payloadType, "raw-extraction")} to ${str(
                topHandoff.targetAgentId,
                "next-agent",
              )}.`
            : "No downstream extraction handoff was emitted.",
        details: compactDetails([
          uniqueTargets.length > 1 ? `Distinct targets: ${uniqueTargets.join(", ")}.` : null,
          topHandoff ? `Confidence: ${str(topHandoff.confidence, "unknown")}.` : null,
        ]),
      },
    ],
  };
}

function buildNormalizationSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const comparisonReadiness = asRecord(raw.comparisonReadiness);
  const dedupeSummary = asRecord(raw.dedupeSummary);
  const handoffPackage = asRecord(raw.handoffPackage);
  const schemaMismatches = toArray<Record<string, unknown>>(raw.schemaMismatches);
  const uncertaintyFlags = toArray<Record<string, unknown>>(raw.uncertaintyFlags);
  const dedupeDecisions = toArray<Record<string, unknown>>(raw.dedupeDecisions);

  if (
    !comparisonReadiness &&
    !dedupeSummary &&
    !handoffPackage &&
    schemaMismatches.length === 0 &&
    uncertaintyFlags.length === 0 &&
    dedupeDecisions.length === 0
  ) {
    return null;
  }

  const topDecision = dedupeDecisions[0];

  return {
    title: "Canonicalization Deck",
    summary: "Comparison readiness, dedupe review, and downstream canonical handoff for this normalization run.",
    cards: [
      {
        id: "normalize-comparison",
        title: "Comparison Readiness",
        status: str(comparisonReadiness?.status, "watching"),
        summary: `Canonical IDs: ${str(comparisonReadiness?.canonicalIdCount, "0")} · duplicates: ${str(
          comparisonReadiness?.duplicateKeyCount,
          "0",
        )} · uncertainty flags: ${str(comparisonReadiness?.uncertaintyCount, "0")}.`,
        details: compactDetails([
          `Handoff target: ${str(handoffPackage?.targetAgentId, "next-agent")}.`,
        ]),
      },
      {
        id: "normalize-dedupe",
        title: "Dedupe And Uncertainty",
        status:
          Number(dedupeSummary?.duplicateKeys ? toArray(dedupeSummary.duplicateKeys).length : 0) > 0 ||
          uncertaintyFlags.length > 0
            ? "watching"
            : "ready",
        summary: `Dedupe keys: ${str(dedupeSummary?.totalKeys, "0")} total with ${toArray(
          dedupeSummary?.duplicateKeys,
        ).length} duplicate key(s).`,
        details: compactDetails([
          topDecision
            ? `Top decision: ${str(topDecision.action, "review-duplicate")} for ${str(
                topDecision.dedupeKey,
                "dedupe-key",
              )}.`
            : null,
          schemaMismatches.length > 0 ? `${schemaMismatches.length} schema mismatch record(s) still need review.` : null,
          uncertaintyFlags.length > 0 ? `${uncertaintyFlags.length} uncertainty flag(s) were emitted.` : null,
        ]),
      },
      {
        id: "normalize-handoff",
        title: "Canonical Handoff",
        status: handoffPackage?.comparisonReady === true ? "ready" : "watching",
        summary:
          handoffPackage
            ? `Canonical dataset routes to ${str(handoffPackage.targetAgentId, "next-agent")} with ${toArray(
                handoffPackage.canonicalIds,
              ).length} canonical id(s).`
            : "No canonical handoff package was emitted.",
        details: compactDetails([
          `Comparison ready: ${handoffPackage?.comparisonReady === true ? "yes" : "no"}.`,
        ]),
      },
    ],
  };
}

function buildMarketResearchSignalDeck(raw: Record<string, unknown>): OperatorSignalDeckVM | null {
  const deltaCapture = asRecord(raw.deltaCapture);
  const changePack = asRecord(raw.changePack);
  const handoffPackage = asRecord(raw.handoffPackage);
  const warnings = normalizeStringList(raw.warnings, 2);

  if (!deltaCapture && !changePack && !handoffPackage && warnings.length === 0) {
    return null;
  }

  return {
    title: "Research Signal Deck",
    summary: "Delta capture, durable change-pack posture, and follow-on routing for this research brief.",
    cards: [
      {
        id: "research-delta",
        title: "Delta Capture",
        status: mapDeltaCaptureStatus(str(deltaCapture?.status, "query-only")),
        summary: `Delta capture is ${str(deltaCapture?.status, "query-only")} with ${str(
          deltaCapture?.substantiveCount,
          "0",
        )} substantive, ${str(deltaCapture?.degradedCount, "0")} degraded, and ${str(
          deltaCapture?.unreachableCount,
          "0",
        )} unreachable signal(s).`,
        details: compactDetails([
          warnings[0] ?? null,
        ]),
      },
      {
        id: "research-change-pack",
        title: "Change Pack",
        status:
          changePack?.degradationResilient === true || Number(changePack?.durableSignalCount ?? 0) > 0
            ? "ready"
            : "watching",
        summary: `Surfaces: ${normalizeStringList(changePack?.surfaces, 3).join(", ") || "none recorded"} with ${str(
          changePack?.durableSignalCount,
          "0",
        )} durable signal(s).`,
        details: compactDetails([
          `Degradation resilient: ${changePack?.degradationResilient === true ? "yes" : "no"}.`,
        ]),
      },
      {
        id: "research-routing",
        title: "Handoff And Confidence",
        status: str(raw.networkPosture, "healthy") === "degraded" ? "watching" : "ready",
        summary:
          handoffPackage
            ? `Route ${str(handoffPackage.payloadType, "market-change-pack")} to ${str(
                handoffPackage.targetAgentId,
                "next-agent",
              )} with confidence ${str(raw.confidence, "unknown")}.`
            : `Confidence ${str(raw.confidence, "unknown")} with no downstream handoff package.`,
        details: compactDetails([
          handoffPackage?.recommendedTaskType
            ? `Recommended task: ${str(handoffPackage.recommendedTaskType, "integration-workflow")}.`
            : null,
          `Network posture: ${str(raw.networkPosture, "healthy")}.`,
        ]),
      },
    ],
  };
}

function buildOperatorSignalDeckVM(runType: string | null | undefined, runResult?: unknown) {
  const raw = asRecord(runResult);
  if (!runType || !raw) return null;

  if (runType === "integration-workflow") return buildIntegrationSignalDeck(raw);
  if (runType === "build-refactor") return buildBuildRefactorSignalDeck(raw);
  if (runType === "drift-repair") return buildDocSpecialistSignalDeck(raw);
  if (runType === "content-generate") return buildContentSignalDeck(raw);
  if (runType === "summarize-content") return buildSummarizationSignalDeck(raw);
  if (runType === "reddit-response") return buildRedditSignalDeck(raw);
  if (runType === "data-extraction") return buildDataExtractionSignalDeck(raw);
  if (runType === "normalize-data") return buildNormalizationSignalDeck(raw);
  if (runType === "market-research") return buildMarketResearchSignalDeck(raw);
  if (runType === "qa-verification") return buildQaSignalDeck(raw);
  if (runType === "security-audit") return buildSecuritySignalDeck(raw);
  if (runType === "system-monitor") return buildSystemMonitorSignalDeck(raw);
  if (runType === "skill-audit") return buildSkillAuditSignalDeck(raw);

  return null;
}

export function TaskRunDetailContent({
  run,
  runResult,
  isLoading,
}: {
  run: RunRowVM | null;
  runResult?: unknown;
  isLoading?: boolean;
}) {
  const timelineEvents = useMemo(() => (run ? buildTimelineEvents(run) : []), [run]);
  const specialistContract = useMemo(() => buildSpecialistContractVM(runResult), [runResult]);
  const knowledgeFreshness = useMemo(() => buildKnowledgeFreshnessVM(runResult), [runResult]);
  const operatorSignalDeck = useMemo(
    () => buildOperatorSignalDeckVM(run?.type, runResult),
    [run?.type, runResult],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!run) {
    return (
      <p className="text-sm text-muted-foreground font-mono text-center py-4">
        Run not found.
      </p>
    );
  }

  return (
    <div className="space-y-3 py-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Type</p>
            <p className="text-[11px] font-mono font-bold text-foreground mt-0.5">{run.type}</p>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Status</p>
            <div className="mt-0.5"><StatusBadge label={run.status} size="sm" /></div>
          </div>
        </div>

        {run.createdAt && (
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Created</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{new Date(run.createdAt).toLocaleString()}</p>
          </div>
        )}

        {run.startedAt && (
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Started</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{new Date(run.startedAt).toLocaleString()}</p>
          </div>
        )}

        {run.completedAt && (
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Completed</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{new Date(run.completedAt).toLocaleString()}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Attempt</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{run.attempt || 1}</p>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Max Retries</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">{run.maxRetries}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Model</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">
              {run.model ?? "local-only"}
            </p>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Cost</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">
              ${run.cost.toFixed(6)}
            </p>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Latency</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">
              {run.latency !== null ? `${Math.round(run.latency)}ms` : "—"}
            </p>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Tokens</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">
              {run.usage?.totalTokens ?? 0}
            </p>
          </div>
        </div>

        {(run.budget || run.accounting?.note) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Budget Status</p>
              <div className="mt-0.5">
                <StatusBadge
                  label={str((run.budget as { status?: unknown } | null)?.status, "unknown")}
                  size="sm"
                />
              </div>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                Remaining calls: {str((run.budget as { remainingLlmCalls?: unknown } | null)?.remainingLlmCalls, "—")}
                {" · "}
                Remaining tokens: {str((run.budget as { remainingTokens?: unknown } | null)?.remainingTokens, "—")}
              </p>
            </div>
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Accounting Note</p>
              <p className="text-[10px] font-mono text-foreground mt-1 leading-relaxed">
                {str((run.accounting as { note?: unknown } | null)?.note, "No additional accounting note recorded.")}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Workflow Stage</p>
            <div className="mt-0.5">
              <StatusBadge label={run.workflow.stage ?? run.status} size="sm" />
            </div>
          </div>
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Approval State</p>
            <p className="text-[11px] font-mono text-foreground mt-0.5">
              {run.approval.required ? run.approval.status ?? "required" : "not required"}
            </p>
          </div>
        </div>

        {(run.workflow.nextRetryAt || run.approval.requestedAt || run.approval.decidedAt) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Approval Requested</p>
              <p className="text-[11px] font-mono text-foreground mt-0.5">
                {run.approval.requestedAt ? new Date(run.approval.requestedAt).toLocaleString() : "—"}
              </p>
            </div>
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Approval Decided</p>
              <p className="text-[11px] font-mono text-foreground mt-0.5">
                {run.approval.decidedAt ? new Date(run.approval.decidedAt).toLocaleString() : "—"}
              </p>
            </div>
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Next Retry</p>
              <p className="text-[11px] font-mono text-foreground mt-0.5">
                {run.workflow.nextRetryAt ? new Date(run.workflow.nextRetryAt).toLocaleString() : "—"}
              </p>
            </div>
          </div>
        )}

        <div className="console-inset p-2">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Replay View</p>
          <p className="text-[10px] font-mono text-foreground mt-1 leading-relaxed">
            This replay now uses orchestrator workflow events, approval state, retry scheduling, history entries, and linked repair records.
          </p>
        </div>

        {(run.workflow.graphStatus || run.workflow.currentStage || run.workflow.blockedStage || run.workflow.stopReason) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Graph Status</p>
              <div className="mt-0.5 flex flex-wrap gap-2">
                {run.workflow.graphStatus && <StatusBadge label={run.workflow.graphStatus} size="sm" />}
                {run.workflow.currentStage && <StatusBadge label={run.workflow.currentStage} size="sm" />}
                {run.workflow.blockedStage && <StatusBadge label={run.workflow.blockedStage} size="sm" />}
                {run.workflow.stopClassification && <StatusBadge label={run.workflow.stopClassification} size="sm" />}
              </div>
              {run.workflow.stopReason && (
                <p className="text-[10px] font-mono text-status-warning mt-2 leading-relaxed">
                  {run.workflow.stopReason}
                </p>
              )}
            </div>
            <div className="console-inset p-2">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Graph Density</p>
              <p className="text-[11px] font-mono text-foreground mt-0.5">
                {run.workflow.nodeCount} nodes · {run.workflow.edgeCount} edges
              </p>
              {(Object.keys(run.workflow.stageDurations).length > 0 || Object.keys(run.workflow.timingBreakdown).length > 0) && (
                <div className="mt-2 space-y-1">
                  {Object.entries(run.workflow.timingBreakdown).map(([stage, timing]) => (
                    <div key={stage} className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground">
                      <span className="uppercase tracking-wider">{stage}</span>
                      <span className="text-foreground">
                        {typeof timing?.durationMs === "number" ? `${Math.round(timing.durationMs)}ms` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {run.approval.note && (
          <div className="console-inset p-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Operator Note</p>
            <p className="text-[10px] font-mono text-foreground mt-1 leading-relaxed">{run.approval.note}</p>
          </div>
        )}

        {run.error && (
          <div className="warning-banner">
            <AlertTriangle className="w-3.5 h-3.5 text-status-error shrink-0" />
            <p className="text-[10px] font-mono text-status-error">{run.error}</p>
          </div>
        )}

        {specialistContract && (
          <div className="console-inset p-3 rounded-sm space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Operator Summary</p>
              <div className="flex gap-2">
                <StatusBadge label={specialistContract.status} size="sm" />
                <StatusBadge label={specialistContract.workflowStage} size="sm" />
              </div>
            </div>
            <p className="text-[10px] font-mono text-foreground leading-relaxed">
              {specialistContract.operatorSummary || "No operator summary recorded."}
            </p>
            {specialistContract.recommendedNextActions.length > 0 && (
              <div className="space-y-1">
                {specialistContract.recommendedNextActions.map((entry, index) => (
                  <p
                    key={`operator-action-${index}`}
                    className="text-[10px] font-mono text-muted-foreground leading-relaxed"
                  >
                    {index + 1}. {entry}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {knowledgeFreshness && (knowledgeFreshness.reviewRecommended || knowledgeFreshness.warnings.length > 0) && (
          <div className="warning-banner">
            <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] font-mono font-semibold text-status-warning uppercase tracking-wider">
                  Knowledge Freshness
                </p>
                <StatusBadge label={knowledgeFreshness.status} size="sm" />
              </div>
              {knowledgeFreshness.packGeneratedAt && (
                <p className="text-[10px] font-mono text-muted-foreground">
                  Pack generated: {new Date(knowledgeFreshness.packGeneratedAt).toLocaleString()}
                  {knowledgeFreshness.packAgeHours != null ? ` · age ${knowledgeFreshness.packAgeHours.toFixed(1)}h` : ""}
                </p>
              )}
              {knowledgeFreshness.docsLatestModifiedAt && (
                <p className="text-[10px] font-mono text-muted-foreground">
                  Latest docs mirror change: {new Date(knowledgeFreshness.docsLatestModifiedAt).toLocaleString()}
                </p>
              )}
              {knowledgeFreshness.warnings.map((warning, index) => (
                <p key={`freshness-warning-${index}`} className="text-[10px] font-mono text-status-warning leading-relaxed">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {operatorSignalDeck && operatorSignalDeck.cards.length > 0 && (
          <div className="console-inset p-3 rounded-sm space-y-3">
            <div className="space-y-1">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                {operatorSignalDeck.title}
              </p>
              <p className="text-[10px] font-mono text-foreground leading-relaxed">
                {operatorSignalDeck.summary}
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {operatorSignalDeck.cards.map((card) => (
                <div key={card.id} className="activity-cell p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                      {card.title}
                    </p>
                    <StatusBadge label={card.status} size="sm" />
                  </div>
                  <p className="text-[10px] font-mono text-foreground leading-relaxed">{card.summary}</p>
                  {card.details.length > 0 && (
                    <div className="space-y-1">
                      {card.details.map((detail, index) => (
                        <p
                          key={`${card.id}-detail-${index}`}
                          className="text-[10px] font-mono text-muted-foreground leading-relaxed"
                        >
                          {detail}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {timelineEvents.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Execution Timeline</p>
            <div className="space-y-2">
              {timelineEvents.map((event, index) => (
                <div key={event.key} className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <TimelineTone tone={event.tone} />
                    {index < timelineEvents.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-border/80 min-h-[28px]" />
                    )}
                  </div>
                  <div className="console-inset p-3 rounded-sm flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                        {event.label}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                        {event.timestamp ? new Date(event.timestamp).toLocaleString() : "No timestamp"}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1 leading-relaxed">
                      {event.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {run.workflowGraph && (
          <div className="space-y-2">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Workflow Graph</p>
            <WorkflowGraphRail run={run} />
            <div className="grid grid-cols-1 gap-2 2xl:grid-cols-3">
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Edges</p>
                <div className="mt-2 space-y-2">
                  {toArray<Record<string, unknown>>(run.workflowGraph.edges).map((edge, index) => (
                    <div key={str(edge.id, `edge-${index}`)} className="activity-cell px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
                          {str(edge.from, "from")} → {str(edge.to, "to")}
                        </span>
                        <StatusBadge label={str(edge.status, "declared")} size="sm" />
                      </div>
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                        {str(edge.detail, "No edge detail recorded.")}
                      </p>
                      {edge.relationship && (
                        <p className="mt-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                          relationship: {str(edge.relationship, "related")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Causal Links</p>
                <div className="mt-2 space-y-2">
                  {toArray<Record<string, unknown>>(run.workflowGraph.causalLinks).map((link, index) => (
                    <div key={str(link.id, `causal-link-${index}`)} className="activity-cell px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                          {str(link.from, "from")} → {str(link.to, "to")}
                        </span>
                        <div className="flex gap-2">
                          {link.relationship && <StatusBadge label={str(link.relationship, "related")} size="sm" />}
                          {link.classification && <StatusBadge label={str(link.classification, "runtime")} size="sm" />}
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                        {str(link.detail, "No causal detail recorded.")}
                      </p>
                    </div>
                  ))}
                  {toArray<Record<string, unknown>>(run.workflowGraph.causalLinks).length === 0 && (
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[10px] font-mono text-muted-foreground">No causal links were emitted for this run.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Workflow Events</p>
                <div className="mt-2 space-y-2">
                  {toArray<Record<string, unknown>>(run.workflowGraph.events).map((event, index) => (
                    <div key={str(event.eventId, `graph-event-${index}`)} className="activity-cell px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                          {str(event.stage, "event")} · {str(event.state, "unknown")}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground">
                          {event.timestamp ? new Date(String(event.timestamp)).toLocaleTimeString() : "—"}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                        {str(event.detail, "No event detail recorded.")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {event.source && (
                          <span className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                            src:{str(event.source, "runtime")}
                          </span>
                        )}
                        {event.actor && (
                          <span className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                            actor:{str(event.actor, "system")}
                          </span>
                        )}
                        {event.toolId && (
                          <span className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                            tool:{str(event.toolId, "unknown")}
                          </span>
                        )}
                        {event.proofTransport && (
                          <span className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                            proof:{str(event.proofTransport, "transport")}
                          </span>
                        )}
                        {event.classification && (
                          <span className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                            class:{str(event.classification, "runtime")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {run.proofLinks.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Proof Links</p>
            <div className="space-y-2">
              {run.proofLinks.map((link, index) => (
                <div key={str(link.id, `proof-${index}`)} className="console-inset p-3 rounded-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                      {str(link.type, "proof")}
                    </span>
                    <StatusBadge label={str(link.status, "pending")} size="sm" />
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                    {str(link.summary, "No proof summary recorded.")}
                  </p>
                  {toNullableString(link.lastAttemptAt) && (
                    <p className="mt-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                      Last attempt {new Date(String(link.lastAttemptAt)).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {run.repair && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Repair Metadata</p>
            <JsonRenderer data={run.repair} maxHeight="none" />
          </div>
        )}

        {run.history.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Execution History</p>
            <div className="space-y-2">
              {run.history.map((entry, index) => (
                <div key={index} className="console-inset p-3 rounded-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
                      {str(entry.result, "unknown")}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {toNullableString(entry.handledAt) ? new Date(String(entry.handledAt)).toLocaleString() : "—"}
                    </span>
                  </div>
                  {toNullableString(entry.message) && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">{String(entry.message)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {runResult && (
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Result</p>
            <JsonRenderer data={runResult} maxHeight="220px" />
          </div>
        )}
    </div>
  );
}
