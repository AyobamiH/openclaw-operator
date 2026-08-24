import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationDeliveryError,
  sendNotification,
} from "../src/notifier.js";

describe("notification external-effect truth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects invalid targets before dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendNotification(
      { channel: "slack", target: "C1234567890" },
      { title: "Digest", summary: "Summary", count: 1 },
      console,
    )).rejects.toMatchObject<Partial<NotificationDeliveryError>>({
      effectState: "confirmed_absent",
      dispatchCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a transport failure after one dispatch as ambiguous", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendNotification(
      { channel: "slack", target: "https://hooks.slack.com/services/test" },
      { title: "Digest", summary: "Summary", count: 1 },
      console,
    )).rejects.toMatchObject<Partial<NotificationDeliveryError>>({
      effectState: "ambiguous",
      dispatchCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records a bounded provider acknowledgement after one successful dispatch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", {
      status: 200,
      headers: { "x-slack-req-id": "provider-request-1" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const receipt = await sendNotification(
      { channel: "slack", target: "https://hooks.slack.com/services/test" },
      { title: "Digest", summary: "Summary", count: 1 },
      console,
    );
    expect(receipt).toMatchObject({
      state: "effect_verified",
      dispatchCount: 1,
      providerOperationId: "provider-request-1",
    });
    expect(receipt).not.toHaveProperty("target");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the canonical OpenClaw Telegram transport exactly once and requires a provider message id", async () => {
    const runOpenClawMessage = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ channel: "telegram", result: { messageId: "telegram-message-one" } }),
      stderr: "",
    });
    const receipt = await sendNotification(
      { channel: "telegram", target: "123456789" },
      { title: "Digest", summary: "Summary", count: 3 },
      console,
      { runOpenClawMessage },
    );
    expect(receipt).toMatchObject({ state: "effect_verified", dispatchCount: 1, providerOperationId: "telegram-message-one" });
    expect(runOpenClawMessage).toHaveBeenCalledTimes(1);
    expect(runOpenClawMessage.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["message", "send", "--channel", "telegram", "--json"]));
  });

  it("keeps a missing Telegram acknowledgement ambiguous and never retries", async () => {
    const runOpenClawMessage = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ channel: "telegram" }), stderr: "" });
    await expect(sendNotification(
      { channel: "telegram", target: "123456789" },
      { title: "Digest", summary: "Summary", count: 3 },
      console,
      { runOpenClawMessage },
    )).rejects.toMatchObject<Partial<NotificationDeliveryError>>({ effectState: "ambiguous", dispatchCount: 1 });
    expect(runOpenClawMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid Telegram target before invoking OpenClaw", async () => {
    const runOpenClawMessage = vi.fn();
    await expect(sendNotification(
      { channel: "telegram", target: "telegram:not-a-cli-target" },
      { title: "Digest", summary: "Summary", count: 3 },
      console,
      { runOpenClawMessage },
    )).rejects.toMatchObject<Partial<NotificationDeliveryError>>({ effectState: "confirmed_absent", dispatchCount: 0 });
    expect(runOpenClawMessage).not.toHaveBeenCalled();
  });
});
