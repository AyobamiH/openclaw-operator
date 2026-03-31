// Each Recent Activity row is its own framed metal module container
// with individually framed cells for each data point

import { StatusBadge } from "./StatusBadge";
import type { RecentTask } from "@/types/console";
import { formatDistanceToNow } from "date-fns";
import { str, toNullableString } from "@/lib/safe-render";

interface ActivityModuleRowProps {
  task: RecentTask;
}

export function ActivityModuleRow({ task }: ActivityModuleRowProps) {
  // Flatten to scalars defensively
  const status = str(task.status, "unknown");
  const taskLabel = str(task.label ?? task.type, "unknown");
  const agentRaw = str(task.agent, "");
  const agentDisplay = agentRaw
    ? (agentRaw === "system" ? "System Monitor" :
      agentRaw.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-'))
    : str(task.type, "unknown");
  const timestamp =
    toNullableString(task.lastSeenAt) ??
    toNullableString(task.completedAt) ??
    toNullableString(task.handledAt) ??
    toNullableString(task.startedAt) ??
    toNullableString(task.createdAt);
  const repeatCount = Number(task.repeatCount ?? 1);

  const statusColor = 
    status === "success" || status === "completed" ? "text-indicator-green" :
    status === "running" ? "text-indicator-blue" :
    status === "failed" ? "text-indicator-red" :
    status === "pending" || status === "pending-approval" ? "text-indicator-amber" :
    "text-indicator-amber";

  const indicatorColor = status === "success" || status === "completed"
    ? 'hsl(142, 65%, 35%)' 
    : status === "failed" 
    ? 'hsl(0, 72%, 40%)' 
    : 'hsl(38, 92%, 45%)';

  return (
    <div className="activity-module-row">
      <div className="flex items-center gap-1.5 p-1.5 relative z-10">
        {/* Task name — framed cell */}
        <div className="activity-cell flex items-center gap-2.5 px-3 py-2 min-w-[160px] flex-1">
          <span className={`indicator-light ${statusColor}`} />
          <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wide truncate">
            {taskLabel}
          </span>
          {repeatCount > 1 && (
            <span className="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-primary">
              x{repeatCount}
            </span>
          )}
        </div>

        {/* Mini indicator block */}
        <MiniIndicatorBlock color={indicatorColor} />

        {/* Status chip — framed cell */}
        <div className="activity-cell px-2.5 py-2 flex items-center justify-center">
          <StatusBadge label={status} size="sm" />
        </div>

        {/* Mini indicator block */}
        <MiniIndicatorBlock color={indicatorColor} />

        {/* Agent — framed cell */}
        <div className="activity-cell px-3 py-2 hidden sm:flex items-center">
          <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide truncate">
            {agentDisplay}
          </span>
        </div>

        {/* Mini indicator block */}
        <div className="hidden md:block">
          <MiniIndicatorBlock color={indicatorColor} />
        </div>

        {/* Timestamp — framed cell */}
        {timestamp && (
          <div className="activity-cell px-3 py-2 hidden md:flex items-center">
            <span className="text-foreground text-[10px] font-mono font-bold uppercase tracking-wide whitespace-nowrap">
              {(() => {
                try { return formatDistanceToNow(new Date(timestamp)) + " ago"; }
                catch { return timestamp; }
              })()}
            </span>
          </div>
        )}

        {/* Right decorative knob area */}
        <div className="hidden lg:flex items-center gap-1.5 pl-1">
          <div className="w-3 h-3 rounded-full" style={{
            background: `radial-gradient(circle at 35% 35%, hsl(216, 8%, 30%), hsl(216, 12%, 16%))`,
            boxShadow: 'inset 0 1px 2px hsl(216, 10%, 36% / 0.4), inset 0 -1px 2px hsl(216, 18%, 5% / 0.6), 0 1px 3px hsl(216, 18%, 3% / 0.4)',
          }} />
          <div className="w-2 h-2 rounded-full" style={{
            background: `radial-gradient(circle at 40% 35%, hsl(216, 8%, 28%), hsl(216, 12%, 14%))`,
            boxShadow: 'inset 0 1px 1px hsl(216, 10%, 32% / 0.3), 0 1px 2px hsl(216, 18%, 3% / 0.3)',
          }} />
        </div>
      </div>
    </div>
  );
}

function MiniIndicatorBlock({ color }: { color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="w-[6px] h-[10px] rounded-[1px]" style={{
        background: `linear-gradient(180deg, ${color} 0%, ${color}99 100%)`,
        boxShadow: `inset 0 1px 0 hsl(0, 0%, 100% / 0.15), 0 0 4px 1px ${color}40, 0 1px 2px hsl(0, 0%, 0% / 0.3)`,
      }} />
      <div className="w-[6px] h-[10px] rounded-[1px]" style={{
        background: `linear-gradient(180deg, hsl(216, 12%, 14%) 0%, hsl(216, 14%, 10%) 100%)`,
        boxShadow: `inset 0 1px 0 hsl(216, 10%, 20% / 0.3), 0 1px 2px hsl(0, 0%, 0% / 0.2)`,
      }} />
    </div>
  );
}
