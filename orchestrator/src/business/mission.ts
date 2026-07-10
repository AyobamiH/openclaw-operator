import type { BusinessMission } from "./types.js";

export const TAIL_WAGGING_BUSINESS_MISSION: BusinessMission = {
  businessId: "tail-wagging-website-design-factory",
  businessName: "Tail Wagging Website Design Factory Northampton",
  mission:
    "Grow Tail Wagging Website Design Factory into a leading AI-powered web design and automation business by continuously identifying, prioritising, executing, verifying and improving work that increases revenue, client satisfaction, product quality, market visibility and operational efficiency.",
  supportedOutcomes: [
    "qualified-leads",
    "paying-clients",
    "increased-revenue",
    "recurring-revenue",
    "faster-delivery",
    "customer-satisfaction",
    "search-visibility",
    "commercial-readiness",
    "product-quality",
    "risk-reduction",
    "manual-work-reduction",
    "reusable-ip",
    "operational-efficiency",
  ],
  runtimeAuthority: "orchestrator/src/business/mission.ts",
  approvalBoundarySummary:
    "Safe local discovery, planning, source/docs edits, tests, builds, evidence capture, drafting, and worker dispatch may proceed inside workspace boundaries. Production, secret, financial, legal, public publishing, protected-branch, deployment, migration, live DNS, and irreversible external actions require explicit approval.",
};

export function loadBusinessMission(): BusinessMission {
  return TAIL_WAGGING_BUSINESS_MISSION;
}
