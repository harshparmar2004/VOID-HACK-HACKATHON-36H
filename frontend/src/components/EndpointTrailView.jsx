import React, { useState } from "react";
import { Search, ArrowRight, ShieldAlert, CheckCircle, ExternalLink, Zap, Lock, DollarSign } from "lucide-react";

export default function EndpointTrailView({
  victimAccount,
  onSearchVictim,
  traceData,
  loading,
  onNavigateToNotices
}) {
  const [inputAcct, setInputAcct] = useState(victimAccount || "");

  const handleSearch = (e) => {
    e.preventDefault();
    if (inputAcct.trim()) {
      onSearchVictim(inputAcct.trim());
    }
  };

  // Group nodes by hop level
  const hopGroups = { 0: [], 1: [], 2: [], 3: [] };
  if (traceData && traceData.nodes) {
    traceData.nodes.forEach((n) => {
      const h = Math.min(n.hop, 3);
      if (hopGroups[h]) hopGroups[h].push(n);
    });
  }

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-serif font-bold text-[#2C2623]">
              Endpoint Multi-Hop Money Trail (Hop 1 → Hop 2 Smurfing → Hop 3 Cashout)
            </h2>
            <p className="text-xs text-[#746D65] mt-1">
              Traces fund flow downstream from victim account across bank-to-bank hops within 50ms.
            </p>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Enter 12-digit Victim Account ID..."
                value={inputAcct}
                onChange={(e) => setInputAcct(e.target.value)}
                className="w-72 bg-[#FBF7EE] border border-[#E8E2D5] rounded-xl px-4 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
              />
              <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            >
              {loading ? "Tracing Trail..." : "Trace Money Trail"}
            </button>
          </form>
        </div>

        {/* Quick Demo Victims */}
        <div className="flex items-center gap-2 mt-3 pt-2 text-xs flex-wrap">
          <span className="text-[#9E968D] font-mono text-[11px]">Demo Inquiry Targets:</span>
          {[
            { id: "100000000001", label: "Sunil Kumar (₹14.7L)" },
            { id: "100000000002", label: "Priya Sharma (₹8.9L)" },
            { id: "100000000003", label: "Ramesh Patel (₹11.2L)" }
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setInputAcct(d.id);
                onSearchVictim(d.id);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#D96B27] border border-[#E8E2D5] font-semibold text-[11px] transition-colors cursor-pointer"
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Trail Metrics Bar */}
        {traceData && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5 pt-4 border-t border-[#F0EAE1]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Latency</span>
              <div className="text-base font-mono font-bold text-[#059669]">{traceData.latency_ms} ms</div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Total Stolen</span>
              <div className="text-base font-mono font-bold text-[#DC2626]">
                ₹{traceData.total_siphoned_inr ? traceData.total_siphoned_inr.toLocaleString('en-IN') : "0"}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Recoverable Holding</span>
              <div className="text-base font-mono font-bold text-[#059669]">
                ₹{traceData.recoverable_holding_inr ? traceData.recoverable_holding_inr.toLocaleString('en-IN') : "0"}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9E968D]">Accounts Involved</span>
              <div className="text-base font-mono font-bold text-[#2C2623]">{traceData.nodes_count} Nodes</div>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={onNavigateToNotices}
                className="px-3.5 py-1.5 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Freeze {traceData.freeze_candidates?.length || 0} Accounts</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4-Column Layered Hop Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Hop 0: Victim */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8E2D5]">
            <span className="text-xs font-bold text-[#059669] uppercase font-mono">HOP 0 • VICTIM ACCOUNT</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#E6F7F0] text-[#059669] font-bold">Origin</span>
          </div>
          {hopGroups[0]?.map((node) => (
            <div key={node.id} className="bg-white border-2 border-[#10B981] rounded-2xl p-4 shadow-2xs">
              <div className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</div>
              <div className="text-[11px] text-[#746D65] mt-1">{node.bank} ({node.ifsc})</div>
              <div className="text-xs font-bold text-[#DC2626] mt-2">Loss: ₹{traceData?.total_siphoned_inr?.toLocaleString('en-IN')}</div>
              <div className="mt-2 text-[10px] text-[#9E968D] font-mono">{node.device_type} • {node.ip_address}</div>
            </div>
          ))}
        </div>

        {/* Hop 1: L1 Collector Mule */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8E2D5]">
            <span className="text-xs font-bold text-[#EA580C] uppercase font-mono">HOP 1 • L1 COLLECTOR</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#FFEDD5] text-[#EA580C] font-bold">Target Mule</span>
          </div>
          {hopGroups[1]?.map((node) => (
            <div key={node.id} className="bg-white border-2 border-[#EA580C] rounded-2xl p-4 shadow-2xs">
              <div className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</div>
              <div className="text-[11px] text-[#746D65] mt-1">{node.bank} ({node.ifsc})</div>
              <div className="text-xs font-bold text-[#EA580C] mt-2">Received: ₹{node.tainted_received?.toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-[#059669] font-bold">Trapped: ₹{node.holding_amount?.toLocaleString('en-IN')}</div>
              <div className="mt-2 text-[10px] text-[#DC2626] font-medium leading-tight">
                ⚡ Dispersed into {hopGroups[2]?.length || 50} accounts within 7 mins
              </div>
            </div>
          ))}
        </div>

        {/* Hop 2: L2 Distributor Mules (The 50 Fan-Out Accounts!) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8E2D5]">
            <span className="text-xs font-bold text-[#D97706] uppercase font-mono">
              HOP 2 • L2 DISTRIBUTORS ({hopGroups[2]?.length || 0})
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold">Smurfing Ring</span>
          </div>
          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
            {hopGroups[2]?.map((node) => (
              <div key={node.id} className="bg-white border border-[#E8E2D5] hover:border-[#D97706] rounded-xl p-3 shadow-2xs transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#FEF3C7] text-[#D97706] font-bold font-mono">
                    Score: {node.risk_score}
                  </span>
                </div>
                <div className="text-[11px] text-[#746D65] mt-0.5">{node.bank} ({node.ifsc})</div>
                <div className="flex items-center justify-between text-xs mt-1.5 font-mono">
                  <span className="text-[#746D65]">Share: ₹{node.tainted_received?.toLocaleString('en-IN')}</span>
                  <span className="text-[#059669] font-bold">Lien: ₹{node.holding_amount?.toLocaleString('en-IN')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hop 3: L3 Terminal Cash-Out */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8E2D5]">
            <span className="text-xs font-bold text-[#7C3AED] uppercase font-mono">HOP 3 • L3 CASH-OUT</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#EDE9FE] text-[#7C3AED] font-bold">Terminal</span>
          </div>
          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
            {hopGroups[3]?.map((node) => (
              <div key={node.id} className="bg-white border border-[#E8E2D5] hover:border-[#7C3AED] rounded-xl p-3 shadow-2xs transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#EDE9FE] text-[#7C3AED] font-bold">
                    Crypto / P2P
                  </span>
                </div>
                <div className="text-[11px] text-[#746D65] mt-0.5">{node.bank} ({node.ifsc})</div>
                <div className="text-xs font-mono font-bold text-[#7C3AED] mt-1.5">
                  Exit: ₹{node.tainted_received?.toLocaleString('en-IN')}
                </div>
                <div className="mt-1 text-[10px] text-[#9E968D] font-mono">
                  IP: {node.ip_address} ({node.device_type})
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
