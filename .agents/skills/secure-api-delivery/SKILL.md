---
name: secure-api-delivery
description: Review API security and integrate practical DevSecOps controls across design, coding, CI/CD, deployment, and operations. Use for API threat models, authorization and tenant-isolation reviews, security test plans, pipeline hardening, release evidence, and actionable security backlogs. Apply OWASP API Security 2023 checks with explicit scope, evidence, and verification limits; complement repository-specific and specialized security skills.
---

# Secure API Delivery

Turn security concerns into scoped checks, evidence, fixes, and feedback. Treat security as part of delivery and operations, rather than a final scanner gate. Preserve the team's existing tools and required checks.

## Establish scope

1. Identify the requested outcome: explain, review, plan, implement, or verify. A review does not authorize patches, publishing, deployments, credential changes, or live scanning.
2. Read repository instructions and existing security workflows before proposing changes. Prefer an applicable repository-specific or specialist skill for deep scans, threat modeling, validation, or fixes; use this skill to connect those activities across delivery stages.
3. Record the commit/version, available artifacts, environments, API boundaries, permitted accounts, and access limits. Resolve uncertainty through read-only inspection first; ask only for missing information needed for consequential steps.
4. Before active tests, establish target authorization, permitted operations, request/concurrency budget, test identities/data, downstream effects, and stop conditions. Prefer isolated fixtures or an explicitly authorized staging environment. An internal hostname or available credentials do not establish permission.
5. Keep secrets and personal data out of reports and test fixtures. Do not send private source, specifications, credentials, or traffic to a new scanning service without authorization. Never retrieve real cloud metadata credentials to prove SSRF or trigger real purchases/messages to prove abuse.

## Build an evidence map

Inspect the API specification, route registration, middleware, authorization logic, serializers, data access, workflow definitions, manifests, and relevant tests. Follow actual execution paths instead of treating a grep hit as a vulnerability.

Produce a compact inventory with operation, owner, environment/version, caller types, authentication, permission rules, data touched, external dependencies, and lifecycle status. Reconcile declared routes with observed deployment/configuration evidence; label unknowns. Do not assume a specification is exhaustive or an undocumented endpoint is exposed.

For each important operation, describe: actor → action → object/tenant → allowed fields → side effect → expected denial. Include anonymous users, ordinary users, a second tenant, and privileged/service identities where applicable. Model abuse of legitimate business flows as well as implementation flaws.

Include internal and service-to-service APIs. Network location or organization ownership alone does not establish trust. Inspect how each caller is authenticated and authorized for the resource, including downstream calls after a service is compromised. Treat segmentation as one control, not a substitute for identity and permissions. See the NIST zero-trust source in [Sources and coverage](references/sources.md).

## Choose and perform checks

- Read [API checks](references/api-checks.md) for endpoint, authorization, integration, or business-flow work. Use the relevant rows, not a mechanical assertion of complete Top 10 coverage.
- Read [Delivery controls](references/delivery-controls.md) for CI/CD, release, governance, or operations work, including separate evidence for discovery, posture, runtime defenses, and active testing.
- Read [Sources and coverage](references/sources.md) when attributing course lessons, checking provenance, or explaining what was learned. Recheck current vendor documentation before writing version-dependent configuration.

Start with the smallest high-value check justified by the threat model. Combine code/configuration review with focused behavioral tests when authorized. Static scanning cannot establish every authorization or business-logic property; a passing dynamic scan cannot establish complete security either.

For a negative authorization test, first establish a legitimate baseline, then change one identity, tenant, object, function, or field. Verify both the response and relevant state/side effects. A denial status after a mutation is not a pass. Use owned synthetic resources and clean up only within authorization.

Track every check as **passed, failed, not run, or not applicable**, with artifact/version, environment, identity/role, expected result, observed result, and evidence. Explain why anything was not run or not applicable. If only planning, mark all proposed tests not run.

Distinguish results reported by supplied artifacts from checks you executed or independently inspected. Record the source and verification limits; do not present someone else's reported pass as your own test run.

## Prioritize and fix within scope

For each finding, distinguish a confirmed weakness from a plausible risk or missing evidence. Record the affected path, source location, prerequisites, realistic impact, confidence, remediation, and regression test. Rank by exposure, reachability, privileges, data/side effects, and business impact; do not equate scanner severity with business priority.

When fixes are authorized, make the smallest coherent change, preserve existing protections, add a regression test, run the relevant required checks, and inspect the final diff. Do not hide findings by disabling checks or widening permissions. Re-test after any later edit. Do not claim readiness while required checks remain failed or unrun.

## Close the feedback loop

Propose owners and acceptance criteria for unresolved work without inventing assignments or deadlines. Recommend shared development/security/operations review and a few meaningful measures: time to remediate, recurring root causes, high-risk operation test coverage, and alert usefulness. Separate existing policy from suggested gate thresholds and exceptions. Never silently weaken an existing release gate.

## Deliver the result

Return, in the user's requested format:

1. Most important finding or decision, with confidence.
2. Scope and evidence examined, including exact version where available.
3. Prioritized findings with concrete next steps and regression checks.
4. Verification ledger: passed, failed, not run, and exclusions.
5. Remaining decisions or authorization needed.

Keep an ordinary summary brief; provide detailed evidence as the task requires. Do not claim certification, course completion, compliance, absence of all vulnerabilities, or production safety from a limited review.

Report **deployable, approved for deployment, and deployed** separately, with evidence for the exact artifact. Passing CI neither proves deployment nor authorizes it.
