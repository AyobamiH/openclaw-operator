import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { loadRegistryBundle } from "./registry.js";
import { PublishingStore } from "./store.js";

type Period = { id: string; startsAt: string; endsAt: string };

type MetricSummary = {
  metricDefinitionId: string;
  availableSamples: number;
  unavailableSamples: number;
  value: number | null;
  aggregation: "sum" | "average";
};

function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function londonOffsetMilliseconds(at: Date): number {
  const name = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/);
  if (!match?.groups?.sign) return 0;
  const magnitude = (Number(match.groups.hours) * 60 + Number(match.groups.minutes)) * 60_000;
  return match.groups.sign === "+" ? magnitude : -magnitude;
}

function londonWallClock(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second, millisecond] = time.split(":").map(Number);
  const wallClockUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, millisecond!);
  let candidate = wallClockUtc;
  for (let index = 0; index < 2; index += 1) {
    candidate = wallClockUtc - londonOffsetMilliseconds(new Date(candidate));
  }
  return new Date(candidate).toISOString();
}

function dailyPeriod(observedAt: Date): Period {
  const id = londonDate(observedAt);
  return { id, startsAt: londonWallClock(id, "00:00:00:000"), endsAt: londonWallClock(id, "23:59:59:999") };
}

function weeklyPeriod(observedAt: Date): Period {
  const localDate = londonDate(observedAt);
  const noon = new Date(`${localDate}T12:00:00.000Z`);
  const weekdayName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(noon);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayName) + 1;
  const monday = new Date(noon);
  monday.setUTCDate(monday.getUTCDate() - (weekday - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const starts = londonDate(monday);
  const ends = londonDate(sunday);
  return { id: `${starts}_${ends}`, startsAt: londonWallClock(starts, "00:00:00:000"), endsAt: londonWallClock(ends, "23:59:59:999") };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function replaceFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function reportMarkdown(report: Record<string, unknown>): string {
  const period = report.period as Period;
  const publications = report.publications as Record<string, number>;
  const conversations = report.conversations as Record<string, number>;
  const attribution = report.attribution as Record<string, number>;
  const metrics = report.metrics as MetricSummary[];
  const experiments = report.experiments as Array<Record<string, unknown>>;
  return [
    `# Campaign commercial report: ${period.id}`,
    "",
    `Period: ${period.startsAt} to ${period.endsAt}`,
    "",
    `Publications: ${publications.total}; verified: ${publications.verified}; failed: ${publications.failed}.`,
    `Conversations: ${conversations.total}; qualified: ${conversations.qualified}.`,
    `Attribution edges: ${attribution.total}.`,
    "",
    "## Metrics",
    "",
    ...metrics.map((metric) => `- ${metric.metricDefinitionId}: ${metric.value === null ? "unavailable" : metric.value} (${metric.availableSamples} available, ${metric.unavailableSamples} unavailable)`),
    "",
    "## Experiments",
    "",
    ...experiments.map((experiment) => `- ${String(experiment.id)}: ${String(experiment.evaluation)}; samples=${String(experiment.availableSamples)}; adjustment=${String(experiment.adjustment)}`),
    "",
    "Unavailable values are not treated as zero. No attribution is inferred without the configured evidence threshold.",
    "",
  ].join("\n");
}

function buildReport(input: {
  store: PublishingStore;
  registry: Awaited<ReturnType<typeof loadRegistryBundle>>;
  period: Period;
  generatedAt: string;
}): Record<string, unknown> {
  const { store, registry, period } = input;
  const publications = store.database.prepare(`
    SELECT state, COUNT(*) AS count
    FROM publishing_publications
    WHERE updated_at BETWEEN ? AND ?
    GROUP BY state
  `).all(period.startsAt, period.endsAt) as Array<{ state: string; count: number }>;
  const publicationCounts = Object.fromEntries(publications.map((row) => [row.state, Number(row.count)]));
  const metricRows = store.database.prepare(`
    SELECT metric_definition_id, availability, value
    FROM publishing_metrics
    WHERE captured_at BETWEEN ? AND ?
  `).all(period.startsAt, period.endsAt) as Array<{
    metric_definition_id: string;
    availability: string;
    value: number | null;
  }>;
  const metrics = registry.metricDefinitions.map((definition): MetricSummary => {
    const rows = metricRows.filter((row) => row.metric_definition_id === definition.id);
    const available = rows.filter((row) => row.availability === "available" && row.value !== null);
    const aggregation = definition.unit === "ratio" ? "average" : "sum";
    const values = available.map((row) => Number(row.value));
    const value = values.length === 0
      ? null
      : aggregation === "average"
        ? values.reduce((total, item) => total + item, 0) / values.length
        : values.reduce((total, item) => total + item, 0);
    return {
      metricDefinitionId: definition.id,
      availableSamples: values.length,
      unavailableSamples: rows.length - values.length,
      value,
      aggregation,
    };
  });
  const conversations = store.database.prepare(`
    SELECT state, COUNT(*) AS count
    FROM publishing_conversations
    WHERE updated_at BETWEEN ? AND ?
    GROUP BY state
  `).all(period.startsAt, period.endsAt) as Array<{ state: string; count: number }>;
  const conversationCounts = Object.fromEntries(conversations.map((row) => [row.state, Number(row.count)]));
  const attribution = store.database.prepare(`
    SELECT COUNT(*) AS count
    FROM publishing_attribution_edges
    WHERE created_at BETWEEN ? AND ?
  `).get(period.startsAt, period.endsAt) as { count: number };
  const experiments = registry.experiments
    .filter((experiment) => experiment.status === "active" && experiment.approved)
    .map((experiment) => {
      const metric = metrics.find((candidate) => candidate.metricDefinitionId === experiment.metricDefinitionId);
      const minimumSamples = experiment.minimumSamples ?? 1;
      return {
        id: experiment.id,
        metricDefinitionId: experiment.metricDefinitionId,
        availableSamples: metric?.availableSamples ?? 0,
        minimumSamples,
        adjustment: experiment.adjustment,
        evaluation: (metric?.availableSamples ?? 0) >= minimumSamples
          ? "measurement_ready"
          : "insufficient_evidence",
        stoppingRule: experiment.stoppingRule ?? "human_review_required_before_adjustment",
      };
    });
  const totalPublications = publications.reduce((total, row) => total + Number(row.count), 0);
  const totalConversations = conversations.reduce((total, row) => total + Number(row.count), 0);
  return {
    schema: "openclaw-campaign-commercial-report.v1",
    generatedAt: input.generatedAt,
    period,
    publications: {
      total: totalPublications,
      verified: publicationCounts.verified ?? 0,
      failed: (publicationCounts.failed ?? 0) + (publicationCounts.failed_closed ?? 0),
      states: publicationCounts,
    },
    metrics,
    conversations: {
      total: totalConversations,
      qualified: conversationCounts.qualified ?? 0,
      states: conversationCounts,
    },
    attribution: { total: Number(attribution.count) },
    experiments,
    evidencePolicy: {
      unavailableIsZero: false,
      attributionMinimumEvidenceEnforced: true,
      automaticPerformanceAdjustment: false,
    },
    externalWrites: 0,
  };
}

export async function runCampaignOperationsCycle(input: {
  registryPath: string;
  databasePath: string;
  artifactRoot: string;
  observedAt?: Date;
}): Promise<Record<string, unknown>> {
  const observedAt = input.observedAt ?? new Date();
  const registry = await loadRegistryBundle(resolve(input.registryPath));
  const store = new PublishingStore(resolve(input.databasePath));
  try {
    const outputRoot = join(resolve(input.artifactRoot), "campaign-commercial-reports");
    const reports = [];
    for (const [cadence, period] of [["daily", dailyPeriod(observedAt)], ["weekly", weeklyPeriod(observedAt)]] as const) {
      const report = buildReport({ store, registry, period, generatedAt: observedAt.toISOString() });
      const json = `${JSON.stringify(report, null, 2)}\n`;
      const jsonPath = join(outputRoot, cadence, `${period.id}.json`);
      const markdownPath = join(outputRoot, cadence, `${period.id}.md`);
      await replaceFile(jsonPath, json);
      await replaceFile(markdownPath, reportMarkdown(report));
      reports.push({ cadence, periodId: period.id, jsonPath, markdownPath, sha256: sha256(json) });
    }
    return { outcome: "completed", reports, externalWrites: 0 };
  } finally {
    store.close();
  }
}
