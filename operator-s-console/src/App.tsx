import { lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DiagnosticsProvider } from "@/contexts/DiagnosticsContext";
import { ConsoleLayout } from "@/components/console/ConsoleLayout";

const ROUTER_BASENAME = "/operator";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const ApprovalsPage = lazy(() => import("./pages/ApprovalsPage"));
const IncidentsPage = lazy(() => import("./pages/IncidentsPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const GovernancePage = lazy(() => import("./pages/GovernancePage"));
const SystemHealthPage = lazy(() => import("./pages/SystemHealthPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const TaskRunsPage = lazy(() => import("./pages/TaskRunsPage"));
const TaskRunDetailPage = lazy(() => import("./pages/TaskRunDetailPage"));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage"));
const PublicProofPage = lazy(() => import("./pages/PublicProofPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.status === 401 || error?.status === 403 || error?.status === 429) return false;
        return failureCount < 2;
      },
    },
  },
});

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{
      background: "linear-gradient(180deg, hsl(216, 12%, 14%) 0%, hsl(216, 18%, 7%) 100%)",
    }}>
      <p className="text-muted-foreground font-mono text-sm animate-pulse">Loading route...</p>
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <RouteLoadingFallback />;
  }

  if (!isAuthenticated) {
    return (
      <LazyPage>
        <LoginPage />
      </LazyPage>
    );
  }

  return (
    <ConsoleLayout>
      <Routes>
        <Route path="/" element={<LazyPage><OverviewPage /></LazyPage>} />
        <Route path="/tasks" element={<LazyPage><TasksPage /></LazyPage>} />
        <Route path="/activity" element={<LazyPage><ActivityPage /></LazyPage>} />
        <Route path="/approvals" element={<LazyPage><ApprovalsPage /></LazyPage>} />
        <Route path="/incidents" element={<LazyPage><IncidentsPage /></LazyPage>} />
        <Route path="/agents" element={<LazyPage><AgentsPage /></LazyPage>} />
        <Route path="/governance" element={<LazyPage><GovernancePage /></LazyPage>} />
        <Route path="/system-health" element={<LazyPage><SystemHealthPage /></LazyPage>} />
        <Route path="/diagnostics" element={<LazyPage><DiagnosticsPage /></LazyPage>} />
        <Route path="/task-runs" element={<LazyPage><TaskRunsPage /></LazyPage>} />
        <Route path="/task-runs/:runId" element={<LazyPage><TaskRunDetailPage /></LazyPage>} />
        <Route path="/knowledge" element={<LazyPage><KnowledgePage /></LazyPage>} />
        <Route path="*" element={<LazyPage><NotFound /></LazyPage>} />
      </Routes>
    </ConsoleLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={ROUTER_BASENAME}>
        <AuthProvider>
          <DiagnosticsProvider>
            <Routes>
              <Route path="/public-proof" element={<LazyPage><PublicProofPage /></LazyPage>} />
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </DiagnosticsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
