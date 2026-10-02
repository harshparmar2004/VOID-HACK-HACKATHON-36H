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
  Zap,
  SlidersHorizontal
} from "lucide-react";
import { num, text } from "../format";


export default function Sidebar({ activeTab, onSelectTab, status, filtersActive }) {
  const s = status?.data;
  const count = (value) => (value == null ? null : num(value));

  const navSections = [
    {
      title: "CASE OPERATIONS",
      items: [
        { id: "intake", label: "Case Intake", icon: UploadCloud, badge: null },
        { id: "vault", label: "Evidence Vault", icon: Shield, badge: null }
      ]
    },
    {
      title: "FORENSIC ANALYSIS",
      items: [
        { id: "parameters", label: "Forensic Parameters", icon: SlidersHorizontal, badge: filtersActive ? "Active" : null },
        { id: "scanner", label: "Fraud Scanner", icon: Zap, badge: null },
        { id: "entities", label: "Entity Directory", icon: Users, badge: count(s?.accounts) },
        { id: "dossier", label: "Mule Dossier", icon: UserX, badge: count(s?.flagged) },
        { id: "graph", label: "Mule Network Graph", icon: Share2, badge: null },
        { id: "trail", label: "Endpoint Trail", icon: GitCommit, badge: null }
      ]
    },
    {
      title: "LEGAL & BENCHMARK",
      items: [
        { id: "notices", label: "Section 91 Notices", icon: FileCheck, badge: null },
        { id: "brief", label: "Investigative Brief", icon: FileText, badge: null },
        { id: "jury", label: "Audit & Evaluation", icon: Award, badge: null }
      ]
    }
  ];

  return (
    <aside className="w-72 bg-[#FBF7EE] border-r border-[#E8E2D5] h-full overflow-y-auto flex flex-col justify-between p-3.5 shrink-0 select-none space-y-4">
      <div className="space-y-5">
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

      {/* Figures from GET /status; a dash while loading or when the API is down. */}
      <div className="pt-3 border-t border-[#E8E2D5] text-[11px] text-[#9E968D] space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>Records loaded:</span>
          <span className="text-[#2C2623] font-bold">{num(s?.records_loaded)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Accounts:</span>
          <span className="text-[#2C2623] font-bold">{num(s?.accounts)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Scoring profile:</span>
          <span className="text-[#2C2623] font-bold">{text(s?.profile_id)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>API:</span>
          <span className={status?.error ? "text-[#DC2626] font-semibold" : "text-[#059669] font-semibold"}>
            {status?.error ? "not reachable" : status?.loading ? "connecting" : "connected"}
          </span>
        </div>
      </div>
    </aside>
  );
}
