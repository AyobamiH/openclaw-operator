import type {
  BusinessValueScoreComponents,
  CandidateWorkItem,
  PriorityScore,
} from "./types.js";

function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Number(value.toFixed(2))));
}

function effortToFactor(effort: CandidateWorkItem["effort"]): number {
  switch (effort) {
    case "low":
      return 1.2;
    case "medium":
      return 2.6;
    case "high":
      return 4.2;
    default:
      return 3;
  }
}

function riskToFactor(candidate: CandidateWorkItem): number {
  if (candidate.approval === "approval-required") return 4.5;
  if (candidate.approval === "unsupported" || candidate.approval === "blocked") return 5;
  const lower = candidate.risk.toLowerCase();
  if (lower.includes("high") || lower.includes("external")) return 4;
  if (lower.includes("medium")) return 2.8;
  return 1.4;
}

function outcomeImpact(candidate: CandidateWorkItem): number {
  switch (candidate.expectedOutcome) {
    case "increased-revenue":
    case "paying-clients":
    case "recurring-revenue":
      return 5;
    case "commercial-readiness":
    case "qualified-leads":
    case "faster-delivery":
      return 4.5;
    case "product-quality":
    case "customer-satisfaction":
    case "search-visibility":
      return 4;
    case "risk-reduction":
    case "manual-work-reduction":
    case "operational-efficiency":
    case "reusable-ip":
      return 3.5;
    default:
      return 3;
  }
}

function evidenceQuality(candidate: CandidateWorkItem): number {
  const count = candidate.evidence.filter((item) => item.trim().length > 0).length;
  if (count >= 4) return 5;
  if (count >= 2) return 4;
  if (count === 1) return 3;
  return 1;
}

function approvalFriction(candidate: CandidateWorkItem): number {
  switch (candidate.approval) {
    case "safe-autonomous":
      return 1;
    case "approval-required":
      return 4;
    case "unsupported":
    case "blocked":
      return 5;
    default:
      return 3;
  }
}

export function scoreCandidate(candidate: CandidateWorkItem): CandidateWorkItem {
  const components: BusinessValueScoreComponents = {
    expectedBusinessImpact: outcomeImpact(candidate),
    confidence: candidate.evidence.length > 0 ? 4 : 2,
    urgency: candidate.kind === "risk" ? 4 : 3,
    effort: effortToFactor(candidate.effort),
    operationalRisk: riskToFactor(candidate),
    dependencyLoad: clampFactor(candidate.dependencies.length + 1),
    commercialReadinessImpact:
      candidate.expectedOutcome === "commercial-readiness" ? 5 : 3,
    reversibility: candidate.approval === "safe-autonomous" ? 5 : 2,
    approvalFriction: approvalFriction(candidate),
    evidenceQuality: evidenceQuality(candidate),
  };

  const denominator = Math.max(
    1,
    components.effort +
      components.operationalRisk +
      components.dependencyLoad +
      components.approvalFriction,
  );
  const value = Number(
    (
      (components.expectedBusinessImpact *
        components.confidence *
        components.urgency *
        components.commercialReadinessImpact *
        components.evidenceQuality *
        components.reversibility) /
      denominator
    ).toFixed(4),
  );

  const score: PriorityScore = {
    value,
    formula:
      "expectedBusinessImpact * confidence * urgency * commercialReadinessImpact * evidenceQuality * reversibility / (effort + operationalRisk + dependencyLoad + approvalFriction)",
    components,
    rationale: [
      `outcome:${candidate.expectedOutcome}`,
      `approval:${candidate.approval}`,
      `evidence:${candidate.evidence.length}`,
      `effort:${candidate.effort}`,
    ],
  };

  return {
    ...candidate,
    score,
  };
}

export function scoreCandidates(candidates: CandidateWorkItem[]): CandidateWorkItem[] {
  return candidates
    .map(scoreCandidate)
    .sort((left, right) => (right.score?.value ?? 0) - (left.score?.value ?? 0));
}
