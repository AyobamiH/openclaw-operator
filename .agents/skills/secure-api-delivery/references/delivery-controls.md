# Delivery controls

Use this proposed control map as a starting point, not a mandatory tool stack. Tailor it to the actual repository, threat model, and release policy.

## Put checks where feedback is useful

| Stage | Candidate checks | Evidence to retain |
| --- | --- | --- |
| Design | Data/trust boundaries, abuse cases, permission matrix, API contract | Reviewed assumptions and security acceptance tests |
| Code/review | Authorization and field handling, secrets, static analysis, dependency changes | Reproducible finding and focused regression test |
| Build | Dependency/image/IaC checks, reproducible inputs, artifact identity | Scanner version/configuration, artifact digest, results |
| Test | Authorized API behavior, tenant isolation, bounded resource and failure cases | Synthetic fixtures, expected/actual response and state |
| Release | Required check results for exact revision, exception status, rollback readiness | Traceable decision and artifact/version |
| Operate | API inventory drift, meaningful auth/abuse alerts, response readiness | Redacted telemetry, owner, investigated signal |
| Improve | Root cause, repeat failures, remediation time, training needs | Backlog/test changes tied to actual incidents |

This map is implementation synthesis informed by the course themes and NIST SSDF. It does not establish compliance with NIST or a specific assurance level.

## Check four complementary coverage areas

The instructor's [related OWASP slides](https://owaspla.owasp.org/assets/prez/OWASPLA_prez_2025_01.pdf), page 6, separate discovery, posture management, runtime protection, and active testing. Map each to actual evidence rather than assuming one scanner covers them all:

| Area | Evidence to request |
| --- | --- |
| Discovery | Current routes/services compared with specifications and observed traffic; changed or retired APIs and ownership |
| Posture | Configuration and vulnerability findings with affected assets, evidence, prioritization, and remediation state |
| Runtime defenses | Which traffic is observed, what creates an alert, whether enforcement is enabled, and who responds |
| Active testing | Authorized behavioral checks with identities, operation coverage, expected results, and execution records |

Record each area's evidence and gaps independently. Missing evidence is not proof a control is absent. Test passes do not prove runtime protection; an alert does not prove prevention or successful compromise. Inspect outcome evidence before assigning either conclusion. Keep detection and prevention claims separate from scanner severity.

These evidence questions are implementation synthesis, not a vendor recommendation. Propose bounded synthetic staging checks when runtime behavior is unknown. Do not enable blocking, replay production attacks, change firewall rules, or send live traffic merely to fill the matrix without the required authorization. Record those tests as not run.

## Keep the pipeline from becoming the attack path

For GitHub Actions, review event trust boundaries, especially privileged workflows handling pull-request content. Do not execute untrusted code or artifacts with deployment credentials. Check least-privilege job permissions, secret exposure in logs, isolated runner behavior, and untrusted data interpolated into scripts. Review workflow dependency locking where supported, or verified immutable action references when not. Prefer tightly scoped short-lived federation over unnecessary long-lived cloud keys, subject to authorized configuration changes. Recheck current platform guidance before generating YAML. [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)

For other CI providers, apply the same trust-boundary questions using their documentation rather than copying GitHub syntax.

## Verify artifacts at promotion

Inspect the exact artifact digest, available signature/provenance, expected signer and issuer or trusted key, and verification result where the artifact is consumed. A matching digest alone does not authenticate its origin. A valid signature does not prove the software is vulnerability-free. Do not weaken identity or digest checks to obtain a pass. Use the project's established verifier and current documentation: [Sigstore verification](https://docs.sigstore.dev/cosign/verifying/verify/) and [GitHub attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

Connect relevant findings and artifact identifiers to deployed workloads and the existing response workflow. Avoid new log destinations or bulk exports without authorization.

## Make gates trustworthy

Start with the existing required checks. Propose fast, accurate regression checks near the change and deeper scoped work where it is useful. Distinguish a failed security assertion from a tool outage, missing credentials, or incomplete coverage. Do not report any of these as a clean scan.

When proposing a new gate, specify the risk caught, expected false-positive burden, runtime budget, owner, and override process. Treat baselining and exceptions as explicit decisions with reason, scope, expiry, and compensating control; never silently suppress older findings. Avoid introducing thresholds as if the user already approved them.

## Apply course lessons incrementally

These scoped practices draw on the [course captions](https://www.youtube.com/watch?v=JfiWi8RjN-8); timestamp provenance is in sources.md.

- Keep OpenAPI contracts close to application code and review them with route, schema, and permission changes for the same release.
- Treat WAF/gateway mitigation separately from correcting the vulnerable application. Record residual risk and the root-fix regression test.
- Select one measurable process improvement per cycle, keep security work visible, limit simultaneous remediation, and use reviewable batches.
- Propose capacity for improvement and skills development. Maintain shared practices and use blameless incident learning with clear ownership. Adapt staffing and time allocations rather than adopting the instructor's ratios as policy.

For recovery planning, evaluate rollback and roll-forward against state, migrations, exposure, and existing approvals; neither is universally safer. Infrastructure as code alone does not prove recoverability.

## Work across teams

Choose testing priorities from a threat model, fit checks to the actual SDLC, and deliver reproducible findings in the team's existing workflow. Include runtime/orchestration as well as application code. [OWASP DevSecOps guidance](https://api-security.owasp.org/editions/2023/en/0xb1-next-devsecops/)

Connect secure delivery with collaboration: identify design disagreements early, share remediation knowledge, and make security, delivery speed, and reliability joint goals. The instructor's related talk emphasizes early design work, behavioral API testing in a running development environment, and aligned team incentives. [Scott Bly at DevOpsDays](https://devopsdays.org/events/2025-los-angeles/program/scott-bly)
