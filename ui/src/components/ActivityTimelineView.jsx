import React, { useState } from "react";
import { Clock, Calendar, Zap, AlertCircle, ArrowRight, BarChart2, TrendingUp } from "lucide-react";

export default function ActivityTimelineView({ traceData }) {
  const [selectedDay, setSelectedDay] = useState(13); // Oct 13 (Day of sample fraud)

  const days = Array.from({ length: 15 }, (_, i) => ({
    day: i + 1,
    date: `Oct ${String(i + 1).padStart(2, '0')}, 2026`,
    txns: i === 12 ? "148,210 txns (SPIKE)" : `${(130000 + (i * 2100) % 15000).toLocaleString('en-IN')} txns`,
    hasFraud: i === 12
  }));

  const timelineEvents = [
    {
      time: "2026-10-13 00:04:00 IST",
      stage: "INITIAL COMPLAINT / FRAUD OCCURRED",
      account: "100000000001 (Sunil Kumar Verma)",
      action: "Victim coerced via Digital Arrest into initiating RTGS transfer of ₹14,78,894.00",
      target: "200000000002 (Axis Bank)",
      velocity: "T+0 min (Golden Hour Begins)"
    },
    {
      time: "2026-10-13 00:11:15 IST",
      stage: "LAYER 1 TO LAYER 2 SMURFING",
      account: "200000000002 (L1 Collector)",
      action: "High-velocity pass-through: Dispersed ₹13,95,000 across 14 distributor mule accounts in 16 simultaneous IMPS/UPI transfers",
      target: "14 Downstream Accounts (SBI, HDFC, ICICI, etc.)",
      velocity: "T+7 min (Pass-Through: 94.3%)"
    },
    {
      time: "2026-10-13 00:19:30 IST",
      stage: "LAYER 2 TO LAYER 3 CASHOUT ATTEMPT",
      account: "200000000010 & 200000000011",
      action: "Funds redirected to P2P Crypto broker for USDT acquisition via foreign proxy IP 194.26.29.11 using Linux_Script headless client",
      target: "Crypto Escrow / P2P Buyer",
      velocity: "T+15 min (Exit Vector Flagged)"
    },
    {
      time: "2026-10-13 00:24:00 IST",
      stage: "RECOVERY WINDOW / ACTIVE HOLDING DETECTED",
      account: "18 Mule Accounts (SBI, HDFC, Axis, Union Bank)",
      action: "Engine identified ₹14,78,894 remaining trapped in active beneficiary balances. Section 91 notices dispatched to stop further dissipation",
      target: "Bank Nodal Freezing Desk",
      velocity: "T+20 min (Critical Actionable Window)"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EA580C]"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              Temporal Forensics & Velocity Analytics
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] mt-1">
            Activity Timeline (15-Day Investigation Window)
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Minute-by-minute temporal reconstruction of money laundering velocity across October 1 – October 15, 2026.
          </p>
        </div>
      </div>

      {/* 15-Day Horizontal Calendar Strip */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs space-y-2">
        <div className="text-xs font-serif font-bold text-[#2C2623] flex items-center justify-between">
          <span>Select Timeline Date (15-Day Investigation Scope):</span>
          <span className="text-[#D96B27] font-mono font-bold">Oct 13, 2026 • Crime Event Detected</span>
        </div>
        <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-15 gap-1.5 overflow-x-auto pt-1">
          {days.map((d) => (
            <button
              key={d.day}
              onClick={() => setSelectedDay(d.day)}
              className={`p-2 rounded-xl text-center border transition-all cursor-pointer ${
                selectedDay === d.day
                  ? "bg-[#D96B27] text-white border-[#D96B27] shadow-sm"
                  : d.hasFraud
                  ? "bg-[#FFF4EC] border-[#D96B27] text-[#D96B27]"
                  : "bg-[#FAF6EE] border-[#E8E2D5] text-[#746D65] hover:bg-[#F3EDE2]"
              }`}
            >
              <div className="text-[10px] font-mono uppercase font-bold">Day {d.day}</div>
              <div className="text-xs font-bold mt-0.5">{d.day}</div>
              {d.hasFraud && (
                <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-1 ${selectedDay === d.day ? "bg-white" : "bg-[#DC2626]"}`}></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chronological Fraud Propagation Flow */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-6">
        <div className="border-b border-[#E8E2D5] pb-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[#2C2623] font-serif">
              Minute-by-Minute Propagation of Stolen Capital (FIR-0142)
            </h3>
            <p className="text-xs text-[#746D65]">
              Shows exact elapsed time between initial victim breach and downstream smurfing transfers.
            </p>
          </div>
          <span className="px-3 py-1 rounded-lg bg-[#E6F7F0] text-[#059669] font-mono text-xs font-bold border border-[#A7F3D0]">
            ⚡ 7-Minute Pass-Through Confirmed
          </span>
        </div>

        <div className="space-y-6 relative before:absolute before:inset-0 before:left-5 before:w-0.5 before:bg-[#E8E2D5]">
          {timelineEvents.map((evt, idx) => (
            <div key={idx} className="relative flex items-start gap-4 pl-2">
              <div className="w-7 h-7 rounded-full bg-[#FAF6EE] border-2 border-[#D96B27] flex items-center justify-center text-[11px] font-mono font-bold text-[#D96B27] shrink-0 z-10">
                {idx + 1}
              </div>
              <div className="flex-1 bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-4 shadow-2xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold text-[#D96B27] uppercase">
                    {evt.stage}
                  </span>
                  <span className="text-[11px] font-mono text-[#746D65]">
                    {evt.time} ({evt.velocity})
                  </span>
                </div>
                <div className="text-xs font-semibold text-[#2C2623] font-mono">
                  {evt.account} → {evt.target}
                </div>
                <p className="text-xs text-[#746D65] leading-relaxed">
                  {evt.action}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
