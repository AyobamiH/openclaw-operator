import { getExecuteSkill, resolveTaskExecuteSkill } from "../../shared/governed-readers.js";
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { buildSpecialistOperatorFields } from '../../shared/runtime-evidence.js';


interface Task {
  id: string;
  type:
    | 'readme'
    | 'api_docs'
    | 'changelog'
    | 'blog_post'
    | 'proof_summary'
    | 'release_notes'
    | 'operator_notice';
  source: any;
  style?: string;
  length?: string;
}
interface Result {
  success: boolean;
  content: string;
  metrics: any;
  executionTime: number;
  warnings?: string[];
  evidenceAnchors?: string[];
  publicationPolicy?: {
    status: 'grounded' | 'speculative-refused' | 'speculative-labeled';
    rationale: string;
  };
  claimDiscipline?: {
    speculativeClaims: string[];
    groundedClaims: number;
  };
  routingDecision?: {
    audience: 'operator' | 'public' | 'general';
    documentMode: 'proof' | 'incident' | 'general';
    downstreamAgent: string;
    escalationRequired: boolean;
  };
  handoffPackage?: {
    targetAgentId: string;
    payloadType: 'publication-summary' | 'incident-summary' | 'proof-handoff';
    evidenceAnchors: string[];
    reason: string;
  };
  evidenceSchema?: {
    rails: string[];
    sourceSummaryCount: number;
    evidenceAttached: boolean;
  };
  documentSpecialization?: {
    mode: 'readme' | 'api-docs' | 'release-notes' | 'operator-notice' | 'proof-summary' | 'general';
    audience: 'operator' | 'public' | 'general';
    riskLevel: 'low' | 'medium' | 'high';
  };
  toolInvocations?: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification?: string;
  }>;
  operatorSummary?: string;
  recommendedNextActions?: string[];
  specialistContract?: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
}


function loadConfig(): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../agent.config.json'), 'utf-8'));
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills[skillId]?.allowed === true;
}

function inferDocumentFormat(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.ipynb') return 'ipynb';
  if (ext === '.pdf') return 'pdf';
  return null;
}

function normalizeSourceDocuments(source: any): Array<{ filePath: string; format: string }> {
  const documents = Array.isArray(source?.documents) ? source.documents : [];
  return documents
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const filePath = typeof entry.filePath === 'string' ? entry.filePath.trim() : '';
      const format = typeof entry.format === 'string' && entry.format.trim().length > 0
        ? entry.format.trim()
        : inferDocumentFormat(filePath);
      if (!filePath || !format) {
        return null;
      }
      return { filePath, format };
    })
    .filter((entry): entry is { filePath: string; format: string } => Boolean(entry));
}

function collectEvidenceAnchors(source: any): string[] {
  const anchors = [
    ...(Array.isArray(source?.evidence) ? source.evidence : []),
    ...(Array.isArray(source?.references) ? source.references : []),
    ...(Array.isArray(source?.urls) ? source.urls : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  if (typeof source?.metadata?.topic === 'string' && source.metadata.topic.trim().length > 0) {
    anchors.push(`topic:${source.metadata.topic.trim()}`);
  }

  return Array.from(new Set(anchors));
}

function detectSpeculativeClaims(source: any): string[] {
  const explicitClaims = Array.isArray(source?.claims) ? source.claims : [];
  const speculativeFromClaims = explicitClaims
    .map((claim) => {
      if (typeof claim === 'string') {
        return /\b(maybe|probably|likely|could|might)\b/i.test(claim) ? claim : null;
      }
      if (claim && typeof claim === 'object' && claim.grounded === false && typeof claim.text === 'string') {
        return claim.text;
      }
      return null;
    })
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (source?.speculative === true && typeof source?.description === 'string') {
    speculativeFromClaims.push(source.description.trim());
  }

  return Array.from(new Set(speculativeFromClaims));
}

function buildRoutingDecision(task: Task, evidenceAnchors: string[]) {
  const audience = task.type === 'proof_summary'
    ? 'public'
    : task.type === 'operator_notice'
      ? 'operator'
    : evidenceAnchors.some((anchor) => anchor.startsWith('incident:'))
      ? 'operator'
      : 'general';
  const documentMode = task.type === 'proof_summary'
    ? 'proof'
    : task.type === 'operator_notice'
      ? 'incident'
    : evidenceAnchors.some((anchor) => anchor.startsWith('incident:'))
      ? 'incident'
      : 'general';
  const downstreamAgent =
    task.type === 'proof_summary'
      ? 'reddit-helper'
      : task.type === 'blog_post'
        ? 'summarization-agent'
        : 'doc-specialist';
  return {
    audience,
    documentMode,
    downstreamAgent,
    escalationRequired: audience === 'operator' && evidenceAnchors.length === 0,
  };
}

function classifyEvidenceRail(anchor: string): string {
  if (anchor.startsWith('incident:')) return 'incident';
  if (anchor.startsWith('task:')) return 'task';
  if (anchor.startsWith('topic:')) return 'topic';
  if (anchor.startsWith('doc:')) return 'document';
  if (/^https?:\/\//.test(anchor)) return 'url';
  return 'source-summary';
}

function buildEvidenceSchema(source: any, evidenceAnchors: string[]) {
  const rails = Array.from(new Set(evidenceAnchors.map((anchor) => classifyEvidenceRail(anchor))));
  const sourceSummaryCount = [source?.description, source?.claim, source?.operatorNote]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .length;
  return {
    rails,
    sourceSummaryCount,
    evidenceAttached: evidenceAnchors.length > 0 || sourceSummaryCount > 0,
  };
}

function resolveDocumentSpecialization(task: Task, routingDecision: ReturnType<typeof buildRoutingDecision>) {
  const mode =
    task.type === 'readme'
      ? 'readme'
      : task.type === 'api_docs'
        ? 'api-docs'
        : task.type === 'changelog' || task.type === 'release_notes'
          ? 'release-notes'
          : task.type === 'operator_notice'
            ? 'operator-notice'
            : task.type === 'proof_summary'
              ? 'proof-summary'
              : 'general';
  return {
    mode,
    audience: routingDecision.audience,
    riskLevel:
      routingDecision.audience === 'operator'
        ? 'high'
        : routingDecision.documentMode === 'proof'
          ? 'medium'
          : 'low',
  };
}

function appendEvidenceAppendix(content: string, source: any, evidenceAnchors: string[]) {
  const summaryLines = [source?.description, source?.claim, source?.operatorNote]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => `- ${value.trim()}`);
  const anchorLines = evidenceAnchors.length > 0
    ? evidenceAnchors.map((anchor) => `- ${anchor}`)
    : ['- No anchors supplied'];
  return `${content.trim()}\n\n## Evidence Rails\n${anchorLines.join('\n')}\n\n## Source Summary\n${summaryLines.length > 0 ? summaryLines.join('\n') : '- No source summary supplied'}\n`;
}

function buildContentSpecialistFields(args: {
  task: Task;
  status: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  operatorSummary: string;
  recommendedNextActions?: Array<string | null | undefined>;
  refusalReason?: string | null;
  escalationReason?: string | null;
}) {
  return buildSpecialistOperatorFields({
    role: 'Content Creator',
    workflowStage:
      args.status === 'refused'
        ? 'publication-refusal'
        : args.status === 'completed'
          ? 'publication-closure'
          : args.status === 'watching'
            ? 'publication-review'
            : 'publication-recovery',
    deliverable:
      'grounded content draft with publication policy, routing decision, and evidence appendix',
    status: args.status,
    operatorSummary: args.operatorSummary,
    recommendedNextActions: args.recommendedNextActions,
    refusalReason: args.refusalReason,
    escalationReason: args.escalationReason,
  });
}

async function handleTask(task: Task): Promise<Result> {
  const startTime = Date.now();

  if (!canUseSkill('documentParser')) {
    return {
      success: false,
      content: '',
      metrics: {},
      ...buildContentSpecialistFields({
        task,
        status: 'refused',
        operatorSummary:
          'Content generation was refused because the governed documentParser path is unavailable to this agent.',
        recommendedNextActions: [
          'Restore documentParser access for content-agent before requesting published output.',
          'Keep this deliverable in draft or operator-review mode until grounding is restored.',
        ],
        refusalReason:
          'Refused content generation because documentParser skill access is not allowed for content-agent.',
      }),
      executionTime: Date.now() - startTime,
    };
  }

  try {
    const executeSkill = resolveTaskExecuteSkill(task) ?? await getExecuteSkill();
    let content = '';
    let wordCount = 0;
    const warnings: string[] = [];
    const toolInvocations: NonNullable<Result['toolInvocations']> = [];
    const parsedDocumentAnchors: string[] = [];
    for (const document of normalizeSourceDocuments(task.source)) {
      const parseResult = await executeSkill('documentParser', {
        filePath: document.filePath,
        format: document.format,
        extractTables: true,
        extractEntities: true,
      }, 'content-agent');

      if (parseResult?.success === true) {
        parsedDocumentAnchors.push(`doc:${document.filePath}`);
        toolInvocations.push({
          toolId: 'documentParser',
          detail: `Parsed ${document.filePath} to ground generated content.`,
          evidence: [
            `file:${document.filePath}`,
            `format:${document.format}`,
            `entities:${Array.isArray(parseResult.entities) ? parseResult.entities.length : 0}`,
          ],
          classification: 'content-grounding',
        });
      } else {
        warnings.push(`Could not parse grounding document ${document.filePath}.`);
      }
    }
    const evidenceAnchors = Array.from(
      new Set([...collectEvidenceAnchors(task.source), ...parsedDocumentAnchors]),
    );
    const speculativeClaims = detectSpeculativeClaims(task.source);
    const routingDecision = buildRoutingDecision(task, evidenceAnchors);
    const evidenceSchema = buildEvidenceSchema(task.source, evidenceAnchors);
    const documentSpecialization = resolveDocumentSpecialization(task, routingDecision);

    if (speculativeClaims.length > 0 && task.source?.allowSpeculative !== true) {
      return {
        success: false,
        content: '',
        metrics: {
          generatedType: task.type,
          wordCount: 0,
          evidenceAnchors: evidenceAnchors.length,
        },
        warnings: ['Speculative claims must be grounded or explicitly allowed before publication.'],
        evidenceAnchors,
        publicationPolicy: {
          status: 'speculative-refused',
          rationale: 'Un-grounded claims were detected in the source payload.',
        },
        claimDiscipline: {
          speculativeClaims,
          groundedClaims: 0,
        },
        routingDecision,
        ...buildContentSpecialistFields({
          task,
          status: 'refused',
          operatorSummary:
            'Content generation refused publication because the source payload contains speculative claims without explicit grounding approval.',
          recommendedNextActions: [
            'Ground the claims with explicit evidence anchors or factual source material.',
            'If speculation is intentional, mark it explicitly and resend with allowSpeculative=true.',
          ],
          refusalReason:
            'Refused publication because speculative claims were detected without explicit grounding approval.',
        }),
        executionTime: Date.now() - startTime,
      };
    }

    switch (task.type) {
      case 'readme':
        content = generateREADME(task.source);
        break;
      case 'api_docs':
        content = generateAPIDocs(task.source);
        break;
      case 'changelog':
        content = generateChangelog(task.source);
        break;
      case 'release_notes':
        content = generateReleaseNotes(task.source);
        break;
      case 'blog_post':
        content = generateBlogPost(task.source);
        break;
      case 'proof_summary':
        content = generateProofSummary(task.source);
        break;
      case 'operator_notice':
        content = generateOperatorNotice(task.source);
        break;
      default:
        content = generateREADME(task.source);
    }

    content = appendEvidenceAppendix(content, task.source, evidenceAnchors);

    if (task.source?.allowSpeculative === true && speculativeClaims.length > 0) {
      warnings.push('Speculative claims were retained and should remain labeled downstream.');
    }

    if (evidenceAnchors.length === 0) {
      warnings.push('Generated content has no explicit evidence anchors in the source payload.');
    }

    wordCount = content.split(/\s+/).length;
    const specialistStatus =
      routingDecision.escalationRequired ||
      warnings.length > 0 ||
      speculativeClaims.length > 0
        ? 'watching'
        : 'completed';
    const specialistFields = buildContentSpecialistFields({
      task,
      status: specialistStatus,
      operatorSummary:
        `Generated ${task.type} content for the ${routingDecision.audience} audience with ${evidenceAnchors.length} evidence anchor(s) and publication policy ${speculativeClaims.length > 0 ? 'speculative-labeled' : 'grounded'}.`,
      recommendedNextActions: [
        `Route this draft through ${routingDecision.downstreamAgent} if you need the next communication or proof step.`,
        warnings[0] ?? null,
        routingDecision.escalationRequired
          ? 'Add explicit evidence anchors before broadening this operator-facing output.'
          : null,
      ],
    });

    return {
      success: true,
      content,
      metrics: {
        generatedType: task.type,
        wordCount,
        estimatedReadTime: Math.ceil(wordCount / 200) + ' min',
        sections: content.split('##').length - 1,
        codeExamples: (content.match(/```/g) || []).length / 2,
        evidenceAnchors: evidenceAnchors.length,
      },
      warnings,
      evidenceAnchors,
      publicationPolicy: {
        status: speculativeClaims.length > 0 ? 'speculative-labeled' : 'grounded',
        rationale:
          speculativeClaims.length > 0
            ? 'Speculative claims were explicitly allowed and should remain labeled.'
            : 'Source claims are grounded by explicit evidence anchors or factual source material.',
      },
      claimDiscipline: {
        speculativeClaims,
        groundedClaims: Math.max(0, evidenceAnchors.length - speculativeClaims.length),
      },
      routingDecision,
      handoffPackage: {
        targetAgentId: routingDecision.downstreamAgent,
        payloadType:
          task.type === 'proof_summary'
            ? 'proof-handoff'
            : evidenceAnchors.some((anchor) => anchor.startsWith('incident:'))
              ? 'incident-summary'
              : 'publication-summary',
        evidenceAnchors,
        reason: 'Generated content should carry evidence anchors into the next communication step.',
      },
      evidenceSchema,
      documentSpecialization,
      toolInvocations,
      ...specialistFields,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      content: '',
      metrics: {},
      ...buildContentSpecialistFields({
        task,
        status: 'blocked',
        operatorSummary:
          'Content generation failed before a grounded deliverable could be produced.',
        recommendedNextActions: [
          'Inspect the generation failure and restore the bounded content path.',
          'Retry only after source grounding and formatting inputs are available again.',
        ],
      }),
      executionTime: Date.now() - startTime,
    };
  }
}

function generateREADME(source: any): string {
  const name = source.name || source.title || source.packageName || 'Project';
  const packageName = source.packageName || source.name || 'package-name';
  const features = toTextList(source.features ?? source.highlights ?? source.capabilities);
  const installCommands = toTextList(source.installation ?? source.install ?? source.setupCommands);
  const docsLinks = toTextList(source.documentation ?? source.docs ?? source.references ?? source.urls);
  const quickStart = typeof source.quickStart === 'string' && source.quickStart.trim().length > 0
    ? source.quickStart.trim()
    : typeof source.usageExample === 'string' && source.usageExample.trim().length > 0
      ? source.usageExample.trim()
      : `const client = require('${packageName}');`;

  return `# ${name}

## Overview
${source.description || source.summary || 'No explicit overview was supplied in the source payload.'}

## Installation
\`\`\`bash
${installCommands.length > 0 ? installCommands.join('\n') : `npm install ${packageName}`}
\`\`\`

## Features
${renderBulletList(features, 'No explicit feature list was supplied in the source payload.')}

## Quick Start
\`\`\`javascript
${quickStart}
\`\`\`

## Documentation
${docsLinks.length > 0 ? docsLinks.map((link) => `- ${link}`).join('\n') : 'See the workspace documentation or source payload references for the next detail layer.'}

## License
${source.license || 'License not supplied in the source payload.'}
`;
}

function generateAPIDocs(source: any): string {
  const endpoints = Array.isArray(source.endpoints) ? source.endpoints : [];
  const renderedEndpoints = endpoints.length > 0
    ? endpoints.map((endpoint: any) => renderEndpoint(endpoint)).join('\n\n')
    : 'No explicit endpoints were supplied in the source payload.';

  return `# API Documentation

## Overview
${source.description || source.summary || 'No explicit API overview was supplied in the source payload.'}

## Authentication
${source.authentication || source.auth || 'No explicit authentication contract was supplied.'}

## Endpoints

${renderedEndpoints}
`;
}

function generateChangelog(source: any): string {
  const groupedChanges = groupChangeEntries(source);
  const version = source.version || source.release || 'unversioned';
  const releaseDate = source.date || source.releasedAt || new Date().toISOString().slice(0, 10);

  return `# Changelog

## [${version}] - ${releaseDate}

### Added
${renderBulletList(groupedChanges.added, 'No added entries were supplied.')}

### Fixed
${renderBulletList(groupedChanges.fixed, 'No fixed entries were supplied.')}

### Changed
${renderBulletList(groupedChanges.changed, source.description || 'No changed entries were supplied.')}
`;
}

function generateReleaseNotes(source: any): string {
  return `# Release Notes

## Release Focus
${source.releaseFocus || source.description || 'Bounded release update'}

## Highlights
- ${source.highlight || 'Operator-facing change summary'}
- ${source.impact || 'Documented impact pending verification'}

## Risk Posture
- ${source.risk || 'No additional runtime risk supplied'}

## Follow-through
- ${source.followThrough || 'Route proof and operator notices before broader publication.'}
`;
}

function generateBlogPost(source: any): string {
  const author = source.author || source.byline || 'OpenClaw';
  const references = toTextList(source.references ?? source.links ?? source.urls);
  const codeExample = typeof source.codeExample === 'string' && source.codeExample.trim().length > 0
    ? source.codeExample.trim()
    : null;

  return `# ${source.title || source.topic || 'Technical Deep Dive'}

By ${author} | ${source.publishedAt || new Date().toLocaleDateString()}

## Introduction
${source.introduction || source.description || source.summary || 'No explicit introduction was supplied in the source payload.'}

## The Problem
${source.problem || source.context || 'No explicit problem statement was supplied in the source payload.'}

## The Solution
${source.solution || source.approach || 'No explicit solution detail was supplied in the source payload.'}
${codeExample ? `\n\n\`\`\`${source.codeLanguage || 'text'}\n${codeExample}\n\`\`\`` : ''}

## Conclusion
${source.conclusion || source.nextSteps || 'No explicit conclusion was supplied in the source payload.'}

## Further Reading
${renderBulletList(references, 'No explicit references were supplied in the source payload.')}
`;
}

function toTextList(value: any): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry === 'object') {
          for (const key of ['text', 'summary', 'title', 'name', 'label', 'path', 'description']) {
            const candidate = entry[key];
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim();
            }
          }
        }
        return null;
      })
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
  ));
}

function renderBulletList(items: string[], fallback: string) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

function renderEndpoint(endpoint: any) {
  const method = (typeof endpoint?.method === 'string' ? endpoint.method : 'GET').toUpperCase();
  const routePath = typeof endpoint?.path === 'string' ? endpoint.path : '/';
  const summary = endpoint?.summary || endpoint?.description || 'No explicit summary supplied.';
  const parameters = toTextList(endpoint?.parameters);
  const statusCodes = toTextList(endpoint?.statusCodes);
  const responseExample = endpoint?.responseExample || endpoint?.response;

  return `### ${method} ${routePath}
${summary}

**Parameters**
${renderBulletList(parameters, 'No explicit parameters supplied.')}

**Response**
\`\`\`json
${typeof responseExample === 'string' ? responseExample : JSON.stringify(responseExample ?? { note: 'No explicit response example supplied.' }, null, 2)}
\`\`\`

**Status Codes**
${renderBulletList(statusCodes, 'No explicit status-code list supplied.')}`;
}

function groupChangeEntries(source: any) {
  const groups = {
    added: toTextList(source.added ?? source.highlights),
    fixed: toTextList(source.fixed ?? source.fixes),
    changed: toTextList(source.changed ?? source.changes),
  };

  if (Array.isArray(source.entries)) {
    for (const entry of source.entries) {
      const text = typeof entry === 'string'
        ? entry.trim()
        : typeof entry?.text === 'string'
          ? entry.text.trim()
          : typeof entry?.summary === 'string'
            ? entry.summary.trim()
            : null;
      if (!text) {
        continue;
      }

      const kind = typeof entry?.type === 'string' ? entry.type.toLowerCase() : 'changed';
      if (kind === 'added' || kind === 'fix' || kind === 'fixed' || kind === 'changed') {
        if (kind === 'added') groups.added.push(text);
        else if (kind === 'fix' || kind === 'fixed') groups.fixed.push(text);
        else groups.changed.push(text);
      } else {
        groups.changed.push(text);
      }
    }
  }

  return {
    added: Array.from(new Set(groups.added)),
    fixed: Array.from(new Set(groups.fixed)),
    changed: Array.from(new Set(groups.changed)),
  };
}

function generateProofSummary(source: any): string {
  const anchors = collectEvidenceAnchors(source);
  return `# Proof Summary

## Claim
${source.claim || source.description || 'No explicit claim supplied.'}

## Evidence Anchors
${anchors.length > 0 ? anchors.map((anchor) => `- ${anchor}`).join('\n') : '- No anchors supplied'}

## Operator Note
${source.operatorNote || 'Use this summary for operator-facing status updates only when anchors remain attached.'}
`;
}

function generateOperatorNotice(source: any): string {
  const anchors = collectEvidenceAnchors(source);
  return `# Operator Notice

## Situation
${source.description || source.claim || 'No explicit operator situation supplied.'}

## Runtime Evidence
${anchors.length > 0 ? anchors.map((anchor) => `- ${anchor}`).join('\n') : '- No anchors supplied'}

## Required Action
- ${source.requiredAction || 'Review the attached evidence rails before routing further changes.'}

## Escalation Boundary
- ${source.escalationBoundary || 'Keep this notice inside operator-only channels until the proof path is verified.'}
`;
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  try {
    const payloadRaw = await readFile(payloadPath, 'utf-8');
    const taskInput = JSON.parse(payloadRaw) as Task;
    const result = await handleTask(taskInput);

    const resultFile = process.env.CONTENT_AGENT_RESULT_FILE;
    if (resultFile) {
      await mkdir(path.dirname(resultFile), { recursive: true });
      await writeFile(resultFile, JSON.stringify(result, null, 2), 'utf-8');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

export { handleTask, loadConfig, canUseSkill };
