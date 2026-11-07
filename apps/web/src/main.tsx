import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { Layout } from "./components/Layout";
import { Overview } from "./pages/Overview";
import { Agents, AgentVersions } from "./pages/Agents";
import { Compare } from "./pages/Compare";
import { Scenarios } from "./pages/Scenarios";
import { ScenarioDetail } from "./pages/ScenarioDetail";
import { ScenarioBuilder } from "./pages/ScenarioBuilder";
import { ScenarioSets } from "./pages/ScenarioSets";
import { Mutations } from "./pages/Mutations";
import { Coverage } from "./pages/Coverage";
import { Runs } from "./pages/Runs";
import { RunDetailPage } from "./pages/RunDetail";
import { Regression } from "./pages/Regression";
import { ReleaseGates } from "./pages/ReleaseGates";
import { Failures } from "./pages/Failures";
import { FailureDetailPage } from "./pages/FailureDetail";
import { Traces, TraceView } from "./pages/TraceView";
import { Metrics } from "./pages/Metrics";
import { SettingsPage } from "./pages/Settings";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Overview /> },
      { path: "/agents", element: <Agents /> },
      { path: "/agents/versions", element: <AgentVersions /> },
      { path: "/compare", element: <Compare /> },
      { path: "/scenarios", element: <Scenarios /> },
      { path: "/scenarios/new", element: <ScenarioBuilder /> },
      { path: "/scenarios/:code", element: <ScenarioDetail /> },
      { path: "/scenario-sets", element: <ScenarioSets /> },
      { path: "/mutations", element: <Mutations /> },
      { path: "/coverage", element: <Coverage /> },
      { path: "/runs", element: <Runs /> },
      { path: "/runs/:id", element: <RunDetailPage /> },
      { path: "/regression", element: <Regression /> },
      { path: "/release-gates", element: <ReleaseGates /> },
      { path: "/failures", element: <Failures /> },
      { path: "/failures/:id", element: <FailureDetailPage /> },
      { path: "/traces", element: <Traces /> },
      { path: "/traces/:id", element: <TraceView /> },
      { path: "/metrics", element: <Metrics /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
