import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/app/layout/Layout";
import { Home } from "@/pages/Home";
import { MarketDetail } from "@/pages/MarketDetail";
import { CreateMarket } from "@/pages/CreateMarket";
import { Dashboard } from "@/pages/Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="market/:id" element={<MarketDetail />} />
          <Route path="create" element={<CreateMarket />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
