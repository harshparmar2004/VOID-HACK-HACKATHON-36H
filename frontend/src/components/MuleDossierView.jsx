import React, { useState } from "react";
import { UserX, Search, Filter, ShieldAlert, AlertCircle } from "lucide-react";

export default function MuleDossierView({ mules, onFilterRole, activeFilter }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMules = mules.filter((m) => {
    const matchesRole = !activeFilter || m.role === activeFilter;
    const matchesSearch = !searchTerm || m.account_id.includes(searchTerm) || m.ifsc.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRole && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623]">
            Mule Account Dossier & 0–100 Risk Index
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Global heuristic detection across 2,000,000 records with two-signal false positive filtering for genuine merchants.
          </p>
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search Account ID or IFSC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-56 bg-white border border-[#E8E2D5] rounded-xl px-3 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
            />
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-2 text-[#9E968D]" />
          </div>

          <div className="flex items-center gap-1 bg-white border border-[#E8E2D5] rounded-xl p-1 text-xs">
            {["ALL", "L1_COLLECTOR", "L2_DISTRIBUTOR", "L3_CASHOUT"].map((role) => (
              <button
                key={role}
                onClick={() => onFilterRole(role === "ALL" ? null : role)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                  (role === "ALL" && !activeFilter) || activeFilter === role
                    ? "bg-[#D96B27] text-white"
                    : "text-[#746D65] hover:text-[#2C2623]"
                }`}
              >
                {role.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
                <th className="py-3 px-4">Account ID & IFSC</th>
                <th className="py-3 px-4">Role Classification</th>
                <th className="py-3 px-4">Mule Risk Index</th>
                <th className="py-3 px-4">Incoming / Dispersed</th>
                <th className="py-3 px-4">P1–P6 Score Breakdown</th>
                <th className="py-3 px-4">Forensic Reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1] font-mono">
              {filteredMules.slice(0, 50).map((m) => (
                <tr key={m.account_id} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#2C2623]">{m.account_id}</div>
                    <div className="text-[11px] text-[#746D65]">{m.ifsc}</div>
                  </td>
                  <td className="py-3 px-4 font-sans">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      m.role === 'L1_COLLECTOR' ? 'bg-[#FFEDD5] text-[#EA580C]' :
                      m.role === 'L2_DISTRIBUTOR' ? 'bg-[#FEF3C7] text-[#D97706]' :
                      'bg-[#EDE9FE] text-[#7C3AED]'
                    }`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm text-[#DC2626]">{m.risk_index}</span>
                      <span className="text-[10px] text-[#9E968D]">/ 100</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-[#059669] font-medium">In: ₹{m.total_incoming_amt?.toLocaleString('en-IN')}</div>
                    <div className="text-[#746D65]">Out: ₹{m.total_outgoing_amt?.toLocaleString('en-IN')}</div>
                  </td>
                  <td className="py-3 px-4 text-[10px] font-mono text-[#746D65]">
                    P1:{m.p1_score} | P2:{m.p2_score} | P3:{m.p3_score} | P4:{m.p4_score}
                  </td>
                  <td className="py-3 px-4 font-sans text-[11px] text-[#746D65] max-w-xs truncate" title={m.forensic_reason}>
                    {m.forensic_reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
