import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { CedarPage, CedarCard, Btn, TopoLines } from "@/components/CedarUI";

// Unknown route inside the shell. Used to silently bounce to chat, which
// hid typos and stale bookmarks; now it says so and offers a way out.
export default function NotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <CedarPage>
      <div style={{ position: "relative", overflow: "hidden", minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <TopoLines height={240} opacity={0.4} />
        <CedarCard padding={40} style={{ maxWidth: 460, width: "100%", textAlign: "center", position: "relative" }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--cedar-2)" }}>
            404 · off the trail
          </div>
          <div style={{ fontFamily: "var(--fd)", fontSize: 28, color: "var(--text)", marginTop: 10 }}>
            Nothing grows here.
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 8, lineHeight: 1.5 }}>
            <code style={{ fontFamily: "var(--fm)", fontSize: 12 }}>{location.pathname}</code> isn't a page in Arz.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 22 }}>
            <Btn kind="ghost" icon={<ArrowLeft size={12} />} onClick={() => navigate(-1)}>Back</Btn>
            <Btn
              kind="outline"
              icon={<Search size={12} />}
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            >
              Search ⌘K
            </Btn>
            <Btn kind="solid" onClick={() => navigate("/")}>Go to chat</Btn>
          </div>
        </CedarCard>
      </div>
    </CedarPage>
  );
}
