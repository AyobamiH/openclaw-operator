/** Deterministic notification delivery with one dispatch and explicit effect truth. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OPENCLAW_MESSAGE_SEND_TIMEOUT_MS = 120_000;

interface NotificationPayload {
  title: string;
  summary: string;
  count: number;
  digest?: Record<string, unknown>;
  url?: string;
}

interface NotifierConfig {
  channel: "slack" | "discord" | "email" | "telegram" | "log";
  target: string;
  slackBotToken?: string;
  emailSmtpUrl?: string;
}

export type NotificationDependencies = {
  runOpenClawMessage?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
};

export type NotificationDeliveryReceipt = {
  channel: NotifierConfig["channel"];
  targetFingerprint: string;
  payloadHash: string;
  dispatchCount: 0 | 1;
  state: "effect_verified" | "local_only";
  providerOperationId?: string;
  providerAcknowledgement: string;
  observedAt: string;
};

export class NotificationDeliveryError extends Error {
  constructor(
    readonly effectState: "confirmed_absent" | "ambiguous",
    readonly dispatchCount: 0 | 1,
    readonly channel: string,
    reason: string,
  ) {
    super(`notification_delivery_${effectState}:${reason}`);
    this.name = "NotificationDeliveryError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function baseReceipt(config: NotifierConfig, payload: NotificationPayload) {
  return {
    channel: config.channel,
    targetFingerprint: hash(config.target).slice(0, 16),
    payloadHash: hash(payload),
    observedAt: new Date().toISOString(),
  };
}

function validatedHttpsUrl(value: string, channel: string, allowedHosts?: string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NotificationDeliveryError("confirmed_absent", 0, channel, "target_url_invalid");
  }
  if (url.protocol !== "https:") {
    throw new NotificationDeliveryError("confirmed_absent", 0, channel, "target_url_must_be_https");
  }
  if (allowedHosts && !allowedHosts.includes(url.hostname)) {
    throw new NotificationDeliveryError("confirmed_absent", 0, channel, "target_host_not_allowlisted");
  }
  return url;
}

async function dispatchJson(args: {
  channel: string;
  url: URL;
  headers?: Record<string, string>;
  body: unknown;
}): Promise<{ response: Response; bodyText: string }> {
  let response: Response;
  try {
    response = await fetch(args.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(args.headers ?? {}) },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new NotificationDeliveryError("ambiguous", 1, args.channel, "transport_outcome_unknown");
  }
  const bodyText = (await response.text()).slice(0, 8192);
  if (!response.ok) {
    throw new NotificationDeliveryError("confirmed_absent", 1, args.channel, `provider_rejected_${response.status}`);
  }
  return { response, bodyText };
}

function providerOperationId(response: Response, bodyText: string): string | undefined {
  for (const name of ["x-slack-req-id", "x-request-id", "x-message-id"]) {
    const value = response.headers.get(name)?.trim();
    if (value) return value;
  }
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : typeof body.ts === "string" ? body.ts : undefined;
    const channel = typeof body.channel === "string" ? body.channel : undefined;
    return id ? (channel ? `${channel}:${id}` : id) : undefined;
  } catch {
    return undefined;
  }
}

async function sendSlackNotification(
  config: NotifierConfig,
  payload: NotificationPayload,
): Promise<NotificationDeliveryReceipt> {
  const message = {
    text: payload.title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `📨 ${payload.title}` } },
      { type: "section", text: { type: "mrkdwn", text: `${payload.summary}\n\n*Ready to Review:* ${payload.count} leads` } },
      ...(payload.url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View Digest" }, url: payload.url, style: "primary" }] }] : []),
    ],
  };
  const botToken = config.slackBotToken?.trim();
  const targetLooksLikeUrl = /^https?:\/\//i.test(config.target);
  const request = botToken && !targetLooksLikeUrl
    ? await dispatchJson({
        channel: "slack",
        url: new URL("https://slack.com/api/chat.postMessage"),
        headers: { Authorization: `Bearer ${botToken}` },
        body: { ...message, channel: config.target },
      })
    : await dispatchJson({
        channel: "slack",
        url: validatedHttpsUrl(config.target, "slack", ["hooks.slack.com"]),
        body: message,
      });
  if (botToken && !targetLooksLikeUrl) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(request.bodyText) as Record<string, unknown>; }
    catch { throw new NotificationDeliveryError("ambiguous", 1, "slack", "provider_acknowledgement_invalid"); }
    if (parsed.ok !== true) throw new NotificationDeliveryError("confirmed_absent", 1, "slack", "provider_rejected_request");
  }
  return {
    ...baseReceipt(config, payload),
    dispatchCount: 1,
    state: "effect_verified",
    providerOperationId: providerOperationId(request.response, request.bodyText),
    providerAcknowledgement: hash({ status: request.response.status, body: request.bodyText }),
  };
}

async function sendDiscordNotification(
  config: NotifierConfig,
  payload: NotificationPayload,
): Promise<NotificationDeliveryReceipt> {
  const url = validatedHttpsUrl(config.target, "discord", ["discord.com", "discordapp.com"]);
  url.searchParams.set("wait", "true");
  const request = await dispatchJson({
    channel: "discord",
    url,
    body: {
      embeds: [{
        title: payload.title,
        description: payload.summary,
        color: 0x5865f2,
        fields: [{ name: "Ready to Review", value: `${payload.count} leads`, inline: true }],
        timestamp: new Date().toISOString(),
      }],
    },
  });
  return {
    ...baseReceipt(config, payload),
    dispatchCount: 1,
    state: "effect_verified",
    providerOperationId: providerOperationId(request.response, request.bodyText),
    providerAcknowledgement: hash({ status: request.response.status, body: request.bodyText }),
  };
}

async function sendEmailNotification(
  config: NotifierConfig,
  payload: NotificationPayload,
): Promise<NotificationDeliveryReceipt> {
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const apiUrl = process.env.EMAIL_API_URL || config.emailSmtpUrl;
  if (!apiUrl || !apiKey) {
    throw new NotificationDeliveryError("confirmed_absent", 0, "email", "provider_configuration_missing");
  }
  const request = await dispatchJson({
    channel: "email",
    url: validatedHttpsUrl(apiUrl, "email"),
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      to: config.target,
      subject: payload.title,
      html: `<h2>${payload.title}</h2><p>${payload.summary}</p><p><strong>Ready to Review:</strong> ${payload.count} leads</p>`,
    },
  });
  return {
    ...baseReceipt(config, payload),
    dispatchCount: 1,
    state: "effect_verified",
    providerOperationId: providerOperationId(request.response, request.bodyText),
    providerAcknowledgement: hash({ status: request.response.status, body: request.bodyText }),
  };
}

function telegramProviderOperationId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["messageId", "primaryPlatformMessageId", "id"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
    if (typeof record[key] === "number") return String(record[key]);
  }
  for (const nested of [record.result, record.receipt, record.delivery]) {
    const id = telegramProviderOperationId(nested);
    if (id) return id;
  }
  return undefined;
}

async function sendTelegramNotification(
  config: NotifierConfig,
  payload: NotificationPayload,
  dependencies: NotificationDependencies,
): Promise<NotificationDeliveryReceipt> {
  if (!/^(?:-?\d+|@[A-Za-z0-9_]{5,32})$/.test(config.target)) {
    throw new NotificationDeliveryError("confirmed_absent", 0, "telegram", "target_invalid");
  }
  const message = `${payload.title}\n\n${payload.summary}\n\nVerified items: ${payload.count}`;
  const run = dependencies.runOpenClawMessage ?? (async (args: string[]) => {
    const result = await execFileAsync("openclaw", args, { timeout: OPENCLAW_MESSAGE_SEND_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  });
  let result: { stdout: string; stderr: string };
  try {
    result = await run(["message", "send", "--channel", "telegram", "--target", config.target, "--message", message, "--json"]);
  } catch {
    throw new NotificationDeliveryError("ambiguous", 1, "telegram", "transport_outcome_unknown");
  }
  let acknowledgement: unknown;
  try { acknowledgement = JSON.parse(result.stdout); }
  catch { throw new NotificationDeliveryError("ambiguous", 1, "telegram", "provider_acknowledgement_invalid"); }
  const operationId = telegramProviderOperationId(acknowledgement);
  if (!operationId) throw new NotificationDeliveryError("ambiguous", 1, "telegram", "provider_acknowledgement_missing_id");
  return {
    ...baseReceipt(config, payload),
    dispatchCount: 1,
    state: "effect_verified",
    providerOperationId: operationId,
    providerAcknowledgement: hash(acknowledgement),
  };
}

export async function sendNotification(
  config: NotifierConfig,
  payload: NotificationPayload,
  logger: Console,
  dependencies: NotificationDependencies = {},
): Promise<NotificationDeliveryReceipt> {
  let receipt: NotificationDeliveryReceipt;
  if (config.channel === "slack") receipt = await sendSlackNotification(config, payload);
  else if (config.channel === "discord") receipt = await sendDiscordNotification(config, payload);
  else if (config.channel === "email") receipt = await sendEmailNotification(config, payload);
  else if (config.channel === "telegram") receipt = await sendTelegramNotification(config, payload, dependencies);
  else if (config.channel === "log") {
    logger.log(`[notifier-log] ${payload.title}: ${payload.summary}`);
    receipt = {
      ...baseReceipt(config, payload),
      dispatchCount: 0,
      state: "local_only",
      providerAcknowledgement: hash({ localOnly: true }),
    };
  } else {
    throw new NotificationDeliveryError("confirmed_absent", 0, String(config.channel), "channel_unsupported");
  }
  logger.log(`[notifier-${config.channel}] delivery receipt ${receipt.payloadHash.slice(0, 12)} (${receipt.state})`);
  return receipt;
}

export function buildNotifierConfig(orcConfig: Record<string, any>): NotifierConfig | null {
  const channel = orcConfig.digestNotificationChannel;
  const target = orcConfig.digestNotificationTarget;
  if (!channel || !target) return null;
  if (!["slack", "discord", "email", "telegram", "log"].includes(String(channel))) return null;
  return {
    channel,
    target: String(target),
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    emailSmtpUrl: process.env.EMAIL_SMTP_URL,
  };
}
