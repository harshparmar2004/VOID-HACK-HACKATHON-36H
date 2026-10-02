import React from "react";
import {
  UploadCloud,
  Shield,
  Users,
  UserX,
  Share2,
  GitCommit,
  FileCheck,
  FileText,
  Award,
  Settings,
  Zap,
  SlidersHorizontal
} from "lucide-react";

export default function Sidebar({
  activeTab,
  onSelectTab,
  counts,
  onOpenSettings,
  forensicParams = {}
}) {
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
        {
          id: "parameters",
          label: "Forensic Parameters",
          icon: SlidersHorizontal,
          badge: Number(forensicParams?.minAmount) > 0 || forensicParams?.bankFilter !== "ALL" ? "Active" : "P1–P10"
        },
        { id: "scanner", label: "Real-Time 60s Scanner", icon: Zap, badge: "60s / 2M" },
        { id: "entities", label: "Entity Directory", icon: Users, badge: counts?.totalAccounts || "24,368" },
        { id: "dossier", label: "Mule Dossier", icon: UserX, badge: counts?.flaggedMules || "333" },
        { id: "graph", label: "Mule Network Graph", icon: Share2, badge: "WebGL" },
        { id: "trail", label: "Endpoint Trail", icon: GitCommit, badge: "4 Hops" }
      ]
    },
    {
      title: "LEGAL & BENCHMARK",
      items: [
        { id: "notices", label: "Section 91 Notices", icon: FileCheck, badge: counts?.noticesCount || "Bank Lien" },
        { id: "brief", label: "Investigative Brief", icon: FileText, badge: "CrPC" },
        { id: "jury", label: "Audit, Evaluation & Settings", icon: Award, badge: "AI & Bench" }
      ]
    }
  ];

  return (
    <aside className="w-72 bg-[#FBF7EE] border-r border-[#E8E2D5] h-full overflow-y-auto flex flex-col justify-between p-3.5 shrink-0 select-none space-y-4">
      <div className="space-y-5">
        {/* Navigation Sections */}
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="flex items-center gap-2 px-2.5 py-1 mb-2 rounded-lg bg-[#EFE8DC] border-l-[3px] border-[#D96B27] shadow-2xs">
              <span className="text-[11px] font-black tracking-wider text-[#2C2623] uppercase font-mono">
                {section.title}
              </span>
            </div>
            <nav className="space-y-0.5">
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
                            : item.badge === "Active"
                            ? "bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-semibold"
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
