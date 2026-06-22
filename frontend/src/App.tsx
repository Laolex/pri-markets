import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/app/layout/Layout";
import { Spinner } from "@/components/ui/Spinner";

// Route-level code splitting: each page (and the heavy chain/FHE code it pulls in) loads
// on demand instead of inflating the initial bundle. Layout stays eager — it's the shell.
const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const MarketDetail = lazy(() => import("@/pages/MarketDetail").then((m) => ({ default: m.MarketDetail })));
const CreateMarket = lazy(() => import("@/pages/CreateMarket").then((m) => ({ default: m.CreateMarket })));
const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-32 gap-3">
      <Spinner size={20} />
      <span className="font-mono text-[11px] text-ink-secondary tracking-wider">LOADING</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route
            index
            element={
              <Suspense fallback={<RouteFallback />}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="market/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <MarketDetail />
              </Suspense>
            }
          />
          <Route
            path="create"
            element={
              <Suspense fallback={<RouteFallback />}>
                <CreateMarket />
              </Suspense>
            }
          />
          <Route
            path="dashboard"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Dashboard />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
