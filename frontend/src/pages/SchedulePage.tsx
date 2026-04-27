import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import ScheduleModal from "@/components/ScheduleModal";

export default function SchedulePage() {
  const navigate = useNavigate();
  return (
    <ScheduleModal
      variant="page"
      onJumpToSession={(id) => {
        // Reactivate if needed and navigate to chat with the deep-link hash
        api.reactivateSession(id)
          .catch(() => {})
          .finally(() => navigate(`/#session=${id}`));
      }}
    />
  );
}
