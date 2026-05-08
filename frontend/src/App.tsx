import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import Layout from "@/pages/Layout";
import ChatPage from "@/pages/ChatPage";
import BoardPage from "@/pages/BoardPage";
import AutopilotPage from "@/pages/AutopilotPage";
import OverviewPage from "@/pages/OverviewPage";
import AgentsPage from "@/pages/AgentsPage";
import MemoryPage from "@/pages/MemoryPage";
import SchedulePage from "@/pages/SchedulePage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import AutonomyPage from "@/pages/AutonomyPage";
import CapabilitiesPage from "@/pages/CapabilitiesPage";
import LLMInstallerPage from "@/pages/LLMInstallerPage";
import SettingsPage from "@/pages/SettingsPage";
import { useTheme } from "@/hooks/useTheme";

export default function App() {
  useTheme(); // applies theme from localStorage on mount
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat/:slug" element={<ChatPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/autopilot" element={<AutopilotPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/capabilities" element={<CapabilitiesPage />} />
          <Route path="/autonomy" element={<AutonomyPage />} />
          <Route path="/models" element={<LLMInstallerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
