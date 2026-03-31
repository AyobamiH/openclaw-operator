import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Command, LogOut, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { ClawMark } from "./ClawMark";
import { LobsterEmblem } from "./LobsterEmblem";
import { MetalTextureDefs, NoiseOverlay } from "./MetalTextures";
import { SideRail, FrameGroove } from "./IndustrialFrame";
import { MobileBottomBar, MobileChassis } from "./MobileChassisFrame";
import { GlobalCommandPalette } from "./GlobalCommandPalette";
import { useIsMobile, useIsNotDesktop } from "@/hooks/use-mobile";

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/tasks", label: "Tasks" },
  { to: "/task-runs", label: "Runs" },
  { to: "/approvals", label: "Approvals" },
  { to: "/incidents", label: "Incidents" },
  { to: "/agents", label: "Agents" },
  { to: "/governance", label: "Governance" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/system-health", label: "System Health" },
  { to: "/diagnostics", label: "Diagnostics" },
];

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
};

export function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isNotDesktop = useIsNotDesktop();
  const { user, logout, apiKeyExpires } = useAuth();
  const openCommandPalette = () => window.dispatchEvent(new Event("open-global-command-palette"));

  const content = (
    <>
      <MetalTextureDefs />
      <NoiseOverlay />
      <GlobalCommandPalette />

      <div className="relative w-full min-h-screen overflow-x-hidden brushed-metal perspective-stage" style={{
        background: `linear-gradient(180deg, 
          hsl(216, 12%, 14%) 0%, 
          hsl(216, 14%, 11%) 20%, 
          hsl(216, 16%, 9%) 60%, 
          hsl(216, 18%, 7%) 100%)`,
      }}>

        {/* === HEADER BAR === */}
        <header className="relative brushed-metal z-10" style={{
          background: `linear-gradient(180deg, 
            hsl(216, 12%, 18%) 0%, 
            hsl(216, 14%, 14%) 30%, 
            hsl(216, 16%, 11%) 70%, 
            hsl(216, 18%, 9%) 100%)`,
          boxShadow: `
            inset 0 1px 0 hsl(216, 10%, 26% / 0.5),
            inset 0 -1px 0 hsl(216, 18%, 5% / 0.6),
            0 4px 12px hsl(216, 18%, 3% / 0.4)`,
          borderRadius: isNotDesktop ? '0' : '4px 4px 0 0',
        }}>
          <div className="px-4 sm:px-6 lg:px-10 py-2 sm:py-4 flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3 sm:gap-5 relative">
              {/* Ambient glow + particles — mobile/tablet only */}
              {isNotDesktop && (
                <div className="absolute inset-0 -inset-x-4 -inset-y-2 pointer-events-none z-0">
                  <div className="absolute inset-0 rounded-full logo-ambient-breathe" style={{
                    background: 'radial-gradient(ellipse at 30% 50%, hsl(22, 80%, 40% / 0.12), transparent 70%)',
                  }} />
                  {[
                    { x: -8, y: -6, size: 2, delay: 0, dur: 3.5 },
                    { x: 12, y: -10, size: 3, delay: 0.8, dur: 4.2 },
                    { x: -4, y: 8, size: 2, delay: 1.5, dur: 3.8 },
                    { x: 20, y: 4, size: 2.5, delay: 2.2, dur: 4 },
                    { x: 6, y: -12, size: 2, delay: 0.4, dur: 3.2 },
                  ].map((p, i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full"
                      style={{
                        width: p.size, height: p.size,
                        left: `calc(35% + ${p.x}px)`,
                        top: `calc(50% + ${p.y}px)`,
                        background: 'hsl(22, 80%, 50%)',
                        opacity: 0,
                      }}
                      animate={{
                        y: [0, -8, -14],
                        opacity: [0, 0.25, 0],
                      }}
                      transition={{
                        duration: p.dur,
                        repeat: Infinity,
                        delay: p.delay,
                        ease: 'easeOut',
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="relative z-10 flex items-center gap-3 sm:gap-5">
                <motion.div
                  whileHover={{ rotateY: 15, rotateX: -5, scale: 1.08 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <LobsterEmblem size={isMobile ? 36 : 64} className={isMobile ? "" : "hidden sm:block"} />
                </motion.div>
                {!isMobile && (
                  <motion.div
                    whileHover={{ rotateY: 15, rotateX: -5, scale: 1.08 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    <LobsterEmblem size={44} className="sm:hidden" />
                  </motion.div>
                )}
                <div className="min-w-0">
                  <h1 className={cn(
                    "font-display font-black text-foreground text-embossed-deep",
                    isMobile ? "text-xl tracking-[0.12em]" : "text-2xl sm:text-4xl lg:text-5xl tracking-[0.18em]"
                  )} style={{
                    textShadow: "0 3px 6px hsl(216, 18%, 3% / 0.7), 0 0 30px hsl(22, 90%, 52% / 0.12), 0 0 60px hsl(22, 90%, 52% / 0.06)",
                    WebkitTextStroke: isMobile ? "0.5px hsl(22, 90%, 52% / 0.1)" : "1px hsl(22, 90%, 52% / 0.1)",
                  }}>
                    OPENCLAW
                  </h1>
                  <div className="hidden sm:block text-[9px] text-muted-foreground font-mono uppercase tracking-[0.35em] mt-1 text-embossed">
                    Operator Console V1
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={openCommandPalette}
                className="hidden md:flex items-center gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] rounded-sm transition-all duration-200 text-muted-foreground border border-border hover:text-foreground hover:border-foreground/20"
                style={{
                  background: "linear-gradient(180deg, hsl(216, 12%, 14%) 0%, hsl(216, 14%, 10%) 100%)",
                  boxShadow: "inset 0 1px 0 hsl(216, 10%, 20% / 0.3), 0 2px 4px hsl(216, 18%, 3% / 0.4)",
                }}
                title="Open command palette"
              >
                <Search className="w-3.5 h-3.5" />
                Command
                <span className="hidden lg:inline-flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[9px]">
                  <Command className="w-2.5 h-2.5" />
                  K
                </span>
              </button>
              <NavLink
                to="/public-proof"
                className={cn(
                  "hidden sm:block px-4 py-2 text-[10px] font-mono uppercase tracking-[0.12em] rounded-sm transition-all duration-200",
                  location.pathname === "/public-proof"
                    ? "text-status-info bg-status-info/10 border border-status-info/30"
                    : "text-muted-foreground border border-border hover:text-foreground hover:border-foreground/20"
                )}
                style={{
                  background: location.pathname !== "/public-proof"
                    ? 'linear-gradient(180deg, hsl(216, 12%, 14%) 0%, hsl(216, 14%, 10%) 100%)'
                    : undefined,
                  boxShadow: 'inset 0 1px 0 hsl(216, 10%, 20% / 0.3), 0 2px 4px hsl(216, 18%, 3% / 0.4)',
                }}
              >
                Public Proof
              </NavLink>
              {user && (
                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{user.role}</span>
                  {user.apiKeyLabel && (
                    <span className="text-[8px] font-mono text-muted-foreground/70 uppercase tracking-wider">{user.apiKeyLabel}</span>
                  )}
                  {user.apiKeyVersion && (
                    <span className="text-[8px] font-mono text-muted-foreground/60 uppercase tracking-wider">v{user.apiKeyVersion}</span>
                  )}
                </div>
              )}
              {apiKeyExpires && (
                <div className="hidden sm:flex items-center gap-1.5 mr-1">
                  <span className="indicator-light text-indicator-amber" style={{ width: 6, height: 6 }} />
                  <span className="text-[8px] font-mono text-status-warning uppercase tracking-wider">Key expiring</span>
                </div>
              )}
              <button
                onClick={logout}
                className={cn("rounded-full overflow-hidden cursor-pointer", isMobile ? "w-7 h-7" : "w-9 h-9")}
                style={{
                  background: 'radial-gradient(circle at 40% 35%, hsl(216, 8%, 30%), hsl(216, 12%, 18%))',
                  border: '2px solid hsl(216, 10%, 20%)',
                  boxShadow: 'inset 0 2px 4px hsl(216, 18%, 5% / 0.5), 0 2px 4px hsl(216, 18%, 3% / 0.4)',
                }}
                title="Logout"
              >
                <div className="w-full h-full flex items-center justify-center">
                  <LogOut className={cn(isMobile ? "w-3 h-3" : "w-4 h-4", "text-muted-foreground")} />
                </div>
              </button>
            </div>
          </div>

          <div className="metal-seam" />

          {/* === DESKTOP NAV TABS === */}
          <div className="relative">
            <nav className="hidden lg:flex items-center gap-1 xl:gap-1.5 px-4 xl:px-10 py-2.5 overflow-x-auto scrollbar-none" style={{
              background: `linear-gradient(180deg, hsl(216, 16%, 8%) 0%, hsl(216, 18%, 6%) 100%)`,
              boxShadow: 'inset 0 3px 8px hsl(216, 18%, 3% / 0.5)',
            }}>
              {navItems.map((item) => {
                const isActive = item.to === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={cn("nav-tab group", isActive && "active")}
                  >
                    {item.label}
                    {isActive && (
                      <motion.div
                        className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                        layoutId="activeTab"
                        style={{
                          background: 'hsl(22, 90%, 52%)',
                          boxShadow: '0 0 8px 2px hsl(22, 90%, 52% / 0.4), 0 0 16px 4px hsl(22, 90%, 52% / 0.15)',
                        }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <FrameGroove />
        </header>

        {/* === MAIN CONTENT === */}
        <div className="flex" style={{ margin: '0' }}>
          <SideRail side="left" />

          <main className="flex-1 min-w-0 overflow-visible" style={{
            background: `linear-gradient(180deg, 
              hsl(216, 16%, 8%) 0%, hsl(216, 18%, 6%) 50%, hsl(216, 16%, 7%) 100%)`,
            minHeight: isNotDesktop ? 'calc(100vh - 180px)' : 'calc(100vh - 200px)',
            paddingBottom: isNotDesktop ? '120px' : '0',
          }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                className={cn("p-3", !isMobile && "sm:p-5 lg:p-6")}
                {...pageTransition}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>

          <SideRail side="right" />
        </div>

        {/* === FOOTER BAR (desktop only) === */}
        <div className="hidden lg:block" style={{ margin: '0' }}>
          <FrameGroove />
          <footer className="relative flex items-center justify-between px-4 sm:px-6 lg:px-10 py-3 brushed-metal" style={{
            background: `linear-gradient(180deg, hsl(216, 12%, 14%) 0%, hsl(216, 14%, 10%) 100%)`,
            boxShadow: `
              inset 0 1px 0 hsl(216, 10%, 20% / 0.4),
              inset 0 -1px 0 hsl(216, 18%, 5% / 0.3)`,
            borderRadius: '0 0 4px 4px',
          }}>
            <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
              OpenClaw Command Interface
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">V1.0</span>
              <div className="opacity-[0.06]">
                <ClawMark size={28} />
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );

  // Mobile & Tablet: wrap in chassis frame + add bottom bar
  if (isNotDesktop) {
    return (
      <div className="min-h-screen">
        <MobileChassis>
          {content}
        </MobileChassis>
        <MobileBottomBar />
      </div>
    );
  }

  // Desktop: standard layout
  return (
    <div className="min-h-screen">
      {content}
    </div>
  );
}
