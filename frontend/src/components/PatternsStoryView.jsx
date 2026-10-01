import React, { useState } from "react";
import { Layers, AlertTriangle, ShieldCheck, Flame, GitFork, ArrowRight, Zap, Globe, Smartphone } from "lucide-react";

export default function PatternsStoryView() {
  const [selectedModus, setSelectedModus] = useState("ALL");

  const modusOperandi = [
    {
      id: "DIGITAL_ARREST",
      title: "Digital Arrest & Impersonation Scheme",
      icon: AlertTriangle,
      color: "border-[#DC2626] text-[#DC2626]",
      victimsTargeted: "Senior Citizens & Professionals",
      avgLoss: "₹12,00,000 to ₹35,00,000",
      launderingPattern: "High-value RTGS/NEFT to L1 Collector within 20 mins of coerced call. Sliced into 15–40 L2 accounts within 7 minutes, exiting to Binance P2P USDT on foreign IPs (185.x.x.x)."
    },
    {
      id: "FAKE_TASK",
      title: "Telegram Fake Task & Rating Fraud",
      icon: Flame,
      color: "border-[#D96B27] text-[#D96B27]",
      victimsTargeted: "Youth, Students & Job Seekers",
      avgLoss: "₹50,000 to ₹5,00,000",
      launderingPattern: "Rapid micro-deposits from hundreds of victims pooling into L1 collector. Funneled within 12 minutes through UPI smurfing into payment gateways."
    },
    {
      id: "PONZI_BOT",
      title: "Automated Crypto Ponzi Bot Syndicate",
      icon: Zap,
      color: "border-[#7C3AED] text-[#7C3AED]",
      victimsTargeted: "Retail Investors",
      avgLoss: "₹2,00,000 to ₹8,00,000",
      launderingPattern: "Multi-hop cyclical layering (L1 → L2 → L2 → L3) to obfuscate provenance before final offshore remittance."
    },
    {
      id: "LOAN_APP",
      title: "Illegal Instant Loan App Extortion",
      icon: Smartphone,
      color: "border-[#059669] text-[#059669]",
      victimsTargeted: "Distressed Borrowers",
      avgLoss: "₹20,000 to ₹1,50,000",
      launderingPattern: "Automated UPI repayment gateways directing stolen funds into rented student mule accounts."
    }
  ];

  const syndicateRings = [
    { ringId: "RING-INDORE-01", modus: "Digital Arrest", l1Count: 2, l2Count: 16, l3Count: 8, totalLaundered: "₹4.25 Crores", leadCollector: "200000000002", exitRail: "Binance P2P / 185.220.101.45" },
    { ringId: "RING-INDORE-02", modus: "Telegram Fake Task", l1Count: 3, l2Count: 22, l3Count: 10, totalLaundered: "₹2.80 Crores", leadCollector: "200000000037", exitRail: "Payment Wallet / 194.26.29.11" },
    { ringId: "RING-INDORE-03", modus: "Ponzi Bot", l1Count: 1, l2Count: 14, l3Count: 6, totalLaundered: "₹1.95 Crores", leadCollector: "200000000072", exitRail: "Crypto P2P USDT" },
    { ringId: "RING-INDORE-04", modus: "Digital Arrest", l1Count: 2, l2Count: 18, l3Count: 7, totalLaundered: "₹3.60 Crores", leadCollector: "200000000107", exitRail: "ATM Withdrawals (Indore/Bhopal)" },
    { ringId: "RING-INDORE-05", modus: "Illegal Loan App", l1Count: 2, l2Count: 20, l3Count: 9, totalLaundered: "₹1.45 Crores", leadCollector: "200000000142", exitRail: "Offshore Gateway / 185.190.22.89" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              Syndicate Intelligence & Modus Operandi
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] mt-1">
            Patterns & Syndicate Ring Stories (42 Active Rings)
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Algorithmic ring clustering connecting 1,470 mules into coherent criminal syndicates based on pass-through velocity and smurfing topology.
          </p>
        </div>
      </div>

      {/* 4 Modus Operandi Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modusOperandi.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.id} className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl bg-[#FAF6EE] border ${m.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#2C2623] font-serif">{m.title}</h3>
                  <div className="text-[11px] text-[#746D65]">Target: {m.victimsTargeted} • Avg: {m.avgLoss}</div>
                </div>
              </div>
              <p className="text-xs text-[#746D65] leading-relaxed bg-[#FAF6EE] p-3 rounded-xl border border-[#F0EAE1]">
                {m.launderingPattern}
              </p>
            </div>
          );
        })}
      </div>

      {/* Syndicate Rings Breakdown Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">
            Top Flagged Mule Syndicate Rings (Indore Jurisdiction)
          </h3>
          <span className="text-xs font-mono text-[#D96B27] font-semibold">42 Rings Identified</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65]">
                <th className="py-3 px-4">Ring Identifier</th>
                <th className="py-3 px-4">Modus Operandi</th>
                <th className="py-3 px-4">Mule Tier Distribution</th>
                <th className="py-3 px-4">Lead Collector Node</th>
                <th className="py-3 px-4">Estimated Volume</th>
                <th className="py-3 px-4 text-right">Exit Gateway / IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1] font-mono">
              {syndicateRings.map((r) => (
                <tr key={r.ringId} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3.5 px-4 font-bold text-[#D96B27]">{r.ringId}</td>
                  <td className="py-3.5 px-4 font-sans font-semibold text-[#2C2623]">{r.modus}</td>
                  <td className="py-3.5 px-4 font-sans">
                    <span className="text-[#EA580C] font-bold">L1: {r.l1Count}</span> •{" "}
                    <span className="text-[#D97706] font-bold">L2: {r.l2Count}</span> •{" "}
                    <span className="text-[#7C3AED] font-bold">L3: {r.l3Count}</span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-[#2C2623]">{r.leadCollector}</td>
                  <td className="py-3.5 px-4 font-bold text-[#DC2626]">{r.totalLaundered}</td>
                  <td className="py-3.5 px-4 text-right font-sans text-[11px] text-[#746D65]">{r.exitRail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
