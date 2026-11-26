/** Host-side evidence adapter. The source provenance gate owns proof decisions. */
export type HostCommand = (program: string, args: string[]) => string;

export type ResidentServiceSnapshot = {
  properties: Record<string, string>;
  unitPath: string;
  pid: number;
  invocationId: string;
  execMainStartTimestampUs: string;
  activeEnterTimestampUs: string;
  processStartTime: string;
  startOrReloadEvent: string;
};

const SYSTEMD_SERVICE = "org.freedesktop.systemd1";

function timestampFromMicroseconds(raw: string): { microseconds: string; iso: string } {
  const match = /^t ([0-9]+)$/.exec(raw.trim());
  if (!match) throw new Error("resident_service_timestamp_invalid");
  const microseconds = BigInt(match[1]);
  if (microseconds <= 0n || microseconds > 8640000000000000000n) {
    throw new Error("resident_service_timestamp_invalid");
  }
  // The existing proof verifier uses milliseconds. Truncation is conservative:
  // if both events fall in the same millisecond it cannot prove a later start.
  return {
    microseconds: microseconds.toString(),
    iso: new Date(Number(microseconds / 1000n)).toISOString(),
  };
}

export function readResidentServiceSnapshot(command: HostCommand, unit: string): ResidentServiceSnapshot {
  const raw = command("systemctl", [
    "--user", "show", unit, "-p", "Id", "-p", "MainPID", "-p", "ExecMainPID",
    "-p", "InvocationID", "-p", "ActiveState", "-p", "ActiveEnterTimestamp",
    "-p", "ExecStart", "-p", "WorkingDirectory", "--no-pager",
  ]);
  const properties = Object.fromEntries(raw.split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
  const pid = Number(properties.MainPID);
  if (!Number.isSafeInteger(pid) || pid <= 0 || Number(properties.ExecMainPID) !== pid) {
    throw new Error("resident_service_main_pid_invalid");
  }
  const invocationId = properties.InvocationID;
  if (properties.ActiveState !== "active" || !/^[a-f0-9]{32}$/i.test(invocationId ?? "") ||
      /^0+$/.test(invocationId) || !properties.Id) {
    throw new Error("resident_service_invocation_invalid");
  }
  // Resolve the unit through systemd itself; never guess D-Bus escaping from the unit name.
  const object = command("busctl", [
    "--user", "call", SYSTEMD_SERVICE, "/org/freedesktop/systemd1",
    SYSTEMD_SERVICE + ".Manager", "GetUnit", "s", properties.Id,
  ]);
  const match = /^o "(\/org\/freedesktop\/systemd1\/unit\/[A-Za-z0-9_]+)"$/.exec(object.trim());
  if (!match) throw new Error("resident_service_unit_path_invalid");
  const unitPath = match[1];
  const get = (iface: string, property: string) => timestampFromMicroseconds(command("busctl", [
    "--user", "get-property", SYSTEMD_SERVICE, unitPath, SYSTEMD_SERVICE + "." + iface, property,
  ]));
  const start = get("Service", "ExecMainStartTimestamp");
  const active = get("Unit", "ActiveEnterTimestamp");
  return {
    properties, unitPath, pid, invocationId,
    execMainStartTimestampUs: start.microseconds,
    activeEnterTimestampUs: active.microseconds,
    processStartTime: start.iso,
    startOrReloadEvent: active.iso,
  };
}

export function assertStableResidentServiceSnapshot(before: ResidentServiceSnapshot, after: ResidentServiceSnapshot): void {
  if (before.pid !== after.pid || before.invocationId !== after.invocationId ||
      before.unitPath !== after.unitPath ||
      before.execMainStartTimestampUs !== after.execMainStartTimestampUs ||
      before.activeEnterTimestampUs !== after.activeEnterTimestampUs ||
      before.properties.WorkingDirectory !== after.properties.WorkingDirectory ||
      before.properties.ExecStart !== after.properties.ExecStart) {
    throw new Error("resident_service_changed_during_capture");
  }
}
