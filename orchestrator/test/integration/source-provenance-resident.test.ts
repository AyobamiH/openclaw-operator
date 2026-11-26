import { describe, expect, it } from "vitest";
import { readResidentServiceSnapshot, assertStableResidentServiceSnapshot } from "../../scripts/source-provenance-resident.js";
import { verifyRuntimeProof, type ResidentRuntimeProof } from "../../src/sourceProvenanceGate.js";

const UNIT_PATH = "/org/freedesktop/systemd1/unit/orchestrator_2eservice";
const HASH = "a".repeat(64);
const ACTIVATION = "2026-11-26T07:38:28.539442Z";
const sourcePath = "/operator/orchestrator/src/index.ts";

function fakeHost(overrides: Partial<{
  pid: string; execPid: string; activeState: string; invocation: string;
  start: string; active: string; object: string; cwd: string;
}> = {}) {
  const x = {
    pid: "34775", execPid: "34775", activeState: "active",
    invocation: "b0990a957f4a48089a23c65b6942239d",
    start: "t 1795678709489225", active: "t 1795678709489815",
    object: `o "${UNIT_PATH}"`, cwd: "/operator/orchestrator", ...overrides,
  };
  return (program: string, args: string[]) => {
    if (program === "systemctl" && args[1] === "show") {
      return [
        "Id=orchestrator.service", `MainPID=${x.pid}`, `ExecMainPID=${x.execPid}`,
        `InvocationID=${x.invocation}`, `ActiveState=${x.activeState}`,
        "ActiveEnterTimestamp=Thu 2026-11-26 07:38:29 GMT",
        "ExecStart=node --import tsx src/index.ts", `WorkingDirectory=${x.cwd}`,
      ].join("\n");
    }
    if (program === "busctl" && args.includes("GetUnit")) {
      expect(args.at(-1)).toBe("orchestrator.service");
      return x.object;
    }
    if (program === "busctl" && args.includes("get-property")) {
      expect(args).toContain(UNIT_PATH);
      if (args.at(-1) === "ExecMainStartTimestamp") return x.start;
      if (args.at(-1) === "ActiveEnterTimestamp") return x.active;
    }
    throw new Error(`unexpected command: ${program} ${args.join(" ")}`);
  };
}

function verifySnapshot(snapshot: ReturnType<typeof readResidentServiceSnapshot>, activationTime = ACTIVATION) {
  const runtime: ResidentRuntimeProof = {
    kind: "resident", runningPid: snapshot.pid, processStartTime: snapshot.processStartTime,
    runningCwd: snapshot.properties.WorkingDirectory, runningEntrypoint: "node --import tsx src/index.ts",
    runningSourcePath: sourcePath, runningFileHash: HASH, serviceUnitAndDropinDigest: HASH,
    startOrReloadEvent: snapshot.startOrReloadEvent, activationTime, postActivationHealth: "healthy",
  };
  return verifyRuntimeProof({ expectedSourcePath: sourcePath, activatedHash: HASH, testedHash: HASH, runtime });
}

describe("source provenance resident host evidence", () => {
  it("recovers the observed false negative without rounding a process start down to the whole second", () => {
    const snapshot = readResidentServiceSnapshot(fakeHost(), "orchestrator.service");
    expect(snapshot).toMatchObject({
      pid: 34775, execMainStartTimestampUs: "1795678709489225",
      activeEnterTimestampUs: "1795678709489815",
      processStartTime: "2026-11-26T07:38:29.489Z",
      startOrReloadEvent: "2026-11-26T07:38:29.489Z",
    });
    expect(verifySnapshot(snapshot)).toMatchObject({ allowed: true, outcome: "PROVEN_ACTIVE" });
  });

  it("does not prove a restart that predates activation even within one second", () => {
    const snapshot = readResidentServiceSnapshot(fakeHost({start: "t 1795678708489225", active: "t 1795678708489815"}), "orchestrator.service");
    expect(verifySnapshot(snapshot)).toMatchObject({ allowed: false, outcome: "ACTIVATED_NOT_RELOADED" });
  });

  it("remains fail-closed for indistinguishable millisecond ordering", () => {
    const snapshot = readResidentServiceSnapshot(fakeHost(), "orchestrator.service");
    expect(verifySnapshot(snapshot, "2026-11-26T07:38:29.489000Z")).toMatchObject({ allowed: false, outcome: "ACTIVATED_NOT_RELOADED" });
  });

  it.each([
    [{execPid: "123"}, "resident_service_main_pid_invalid"],
    [{pid: "0", execPid: "0"}, "resident_service_main_pid_invalid"],
    [{activeState: "inactive"}, "resident_service_invocation_invalid"],
    [{invocation: "0".repeat(32)}, "resident_service_invocation_invalid"],
    [{object: 'o "/unexpected/unit"'}, "resident_service_unit_path_invalid"],
    [{start: "t 0"}, "resident_service_timestamp_invalid"],
    [{active: "s 1795678709489815"}, "resident_service_timestamp_invalid"],
    [{start: "t 8640000000000000001"}, "resident_service_timestamp_invalid"],
  ])("rejects missing or contradictory systemd identity/time evidence", (overrides, error) => {
    expect(() => readResidentServiceSnapshot(fakeHost(overrides), "orchestrator.service")).toThrow(error);
  });

  it("detects a replacement invocation during evidence collection", () => {
    const before = readResidentServiceSnapshot(fakeHost(), "orchestrator.service");
    const unchanged = readResidentServiceSnapshot(fakeHost(), "orchestrator.service");
    expect(() => assertStableResidentServiceSnapshot(before, unchanged)).not.toThrow();
    const after = readResidentServiceSnapshot(fakeHost({invocation: "c".repeat(32)}), "orchestrator.service");
    expect(() => assertStableResidentServiceSnapshot(before, after)).toThrow("resident_service_changed_during_capture");
  });
});
