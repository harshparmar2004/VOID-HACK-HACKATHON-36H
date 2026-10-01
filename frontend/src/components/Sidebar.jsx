import React from "react";
import {
  UploadCloud,
  Shield,
  Users,
  UserX,
  Share2,
  GitCommit,
  Layers,
  FileCheck,
  FileText,
  Award,
  Settings,
  Zap
} from "lucide-react";

export default function Sidebar({ activeTab, onSelectTab, counts, onOpenSettings }) {
  const navSections = [
    {
      title: "CASE OPERATIONS",
      items: [
        { id: "intake", label: "Case Intake", icon: UploadCloud, badge: null },
        { id: "vault", label: "Evidence Vault", icon: Shield, badge: "SHA-256" }
      ]
    },
    {
      title: "FORENSIC ANALYSIS",
      items: [
        { id: "scanner", label: "Real-Time 60s Scanner", icon: Zap, badge: "60s / 2M" },
        { id: "entities", label: "Entity Directory", icon: Users, badge: counts?.totalAccounts || "24,368" },
        { id: "dossier", label: "Mule Dossier", icon: UserX, badge: counts?.flaggedMules || "333" },
        { id: "graph", label: "Mule Network Graph", icon: Share2, badge: "WebGL" },
        { id: "trail", label: "Endpoint Trail", icon: GitCommit, badge: "4 Hops" },
        { id: "patterns", label: "Patterns & Story", icon: Layers, badge: null }
      ]
    },
    {
      title: "LEGAL & BENCHMARK",
      items: [
        { id: "notices", label: "Section 91 Notices", icon: FileCheck, badge: counts?.noticesCount || "Bank Lien" },
        { id: "brief", label: "Investigative Brief", icon: FileText, badge: "CrPC" },
        { id: "jury", label: "Audit & Evaluation", icon: Award, badge: "Blind Test" }
      ]
    }
  ];

  return (
    <aside className="w-64 bg-[#FBF7EE] border-r border-[#E8E2D5] h-full overflow-y-auto flex flex-col justify-between p-4 shrink-0 select-none">
      <div className="space-y-6">
        {navSections.map((section) => (
          <div key={section.title}>
            <div className="text-[10px] font-bold tracking-widest text-[#9E968D] uppercase px-3 mb-2 font-mono">
              {section.title}
            </div>
            <nav className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      isActive
                        ? "bg-[#F3EDE2] text-[#D96B27] font-semibold shadow-2xs border border-[#E4DBD0]"
                        : "text-[#746D65] hover:bg-[#F6F1E8] hover:text-[#2C2623]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? "text-[#D96B27]" : "text-[#9E968D]"}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                          isActive
                            ? "bg-[#D96B27] text-white"
                            : "bg-[#EAE4D8] text-[#746D65]"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* Settings Action Button */}
      <div className="pt-2">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white hover:bg-[#F5EDE1] border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold transition-all shadow-2xs cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#D96B27] group-hover:rotate-45 transition-transform" />
            <span>LLM & JEV Settings</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3EDE2] text-[#746D65] border border-[#E8E2D5] font-mono">
            API Keys
          </span>
        </button>
      </div>

      {/* Local System Info Footer */}
      <div className="pt-3 border-t border-[#E8E2D5] text-[11px] text-[#9E968D] space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>Local Engine:</span>
          <span className="text-[#059669] font-semibold">DuckDB v1.5</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Records Indexed:</span>
          <span className="text-[#2C2623] font-bold">2,000,000</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Network Compute:</span>
          <span className="text-[#D96B27] font-semibold">100% Offline</span>
        </div>
      </div>
    </aside>
  );
}
