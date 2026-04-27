import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import Layout from "@/pages/Layout";
import ChatPage from "@/pages/ChatPage";
import OverviewPage from "@/pages/OverviewPage";
import AgentsPage from "@/pages/AgentsPage";
import MemoryPage from "@/pages/MemoryPage";
import SchedulePage from "@/pages/SchedulePage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import CapabilitiesPage from "@/pages/CapabilitiesPage";
import SettingsPage from "@/pages/SettingsPage";
import ShortcutsPage from "@/pages/ShortcutsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/capabilities" element={<CapabilitiesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/shortcuts" element={<ShortcutsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
