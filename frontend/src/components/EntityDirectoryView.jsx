import React, { useState } from "react";
import { Users, Search, Building2, CreditCard, ArrowDownRight, ArrowUpRight, Filter } from "lucide-react";

export default function EntityDirectoryView({ totalAccounts = "24,368" }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState("ALL");

  const bankStats = [
    { code: "SBIN", name: "State Bank of India", count: "4,821 accounts", share: "19.8%" },
    { code: "HDFC", name: "HDFC Bank", count: "4,120 accounts", share: "16.9%" },
    { code: "ICIC", name: "ICICI Bank", count: "3,890 accounts", share: "16.0%" },
    { code: "UTIB", name: "Axis Bank", count: "2,980 accounts", share: "12.2%" },
    { code: "PUNB", name: "Punjab National Bank", count: "2,410 accounts", share: "9.9%" },
    { code: "UBIN", name: "Union Bank of India", count: "2,150 accounts", share: "8.8%" },
    { code: "KKBK", name: "Kotak Mahindra Bank", count: "1,987 accounts", share: "8.2%" }
  ];

  const sampleEntities = [
    { account: "100000000001", bank: "HDFC Bank", ifsc: "HDFC0000250", type: "Victim / Complainant", totalIn: 0, totalOut: 1478894, balance: 0, risk: "CLEAN" },
    { account: "200000000002", bank: "Axis Bank", ifsc: "UTIB0000971", type: "Suspected L1 Collector", totalIn: 1478894, totalOut: 1395000, balance: 83894, risk: "HIGH RISK (95)" },
    { account: "200000000010", bank: "State Bank of India", ifsc: "SBIN0001100", type: "Suspected L2 Distributor", totalIn: 99642, totalOut: 10000, balance: 89642, risk: "HIGH RISK (91)" },
    { account: "200000000011", bank: "HDFC Bank", ifsc: "HDFC0001101", type: "Suspected L2 Distributor", totalIn: 99642, totalOut: 10000, balance: 89642, risk: "HIGH RISK (89)" },
    { account: "200000000012", bank: "ICICI Bank", ifsc: "ICIC0001102", type: "Suspected L2 Distributor", totalIn: 99642, totalOut: 10000, balance: 89642, risk: "HIGH RISK (93)" },
    { account: "200000000030", bank: "ICICI Bank", ifsc: "ICIC0000892", type: "Suspected L3 Cashout", totalIn: 70000, totalOut: 0, balance: 70000, risk: "CRITICAL (98)" },
    { account: "300000000045", bank: "Punjab National Bank", ifsc: "PUNB0006734", type: "Regular Merchant", totalIn: 450000, totalOut: 420000, balance: 30000, risk: "CLEAN" },
    { account: "300000000112", bank: "Canara Bank", ifsc: "CNRB0009823", type: "Regular Retail Account", totalIn: 85000, totalOut: 75000, balance: 10000, risk: "CLEAN" },
    { account: "300000000219", bank: "Bank of Baroda", ifsc: "BARB0001129", type: "Corporate Payroll Account", totalIn: 2500000, totalOut: 2450000, balance: 50000, risk: "CLEAN" }
  ];

  const filtered = sampleEntities.filter((e) => {
    const matchesSearch = e.account.includes(searchTerm) || e.ifsc.toLowerCase().includes(searchTerm.toLowerCase()) || e.bank.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBank = selectedBank === "ALL" || e.ifsc.startsWith(selectedBank);
    return matchesSearch && matchesBank;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D96B27]"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              Master Banking Accounts Index
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] mt-1">
            Entity Directory ({totalAccounts} Accounts)
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Complete database of unique sender and receiver accounts extracted from 2,000,000 transactions across 10 major Indian banks.
          </p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              placeholder="Search Account ID, Bank, or IFSC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-72 bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
            />
            <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
          </div>

          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            className="bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
          >
            <option value="ALL">All Banks</option>
            <option value="SBIN">State Bank of India</option>
            <option value="HDFC">HDFC Bank</option>
            <option value="ICIC">ICICI Bank</option>
            <option value="UTIB">Axis Bank</option>
            <option value="PUNB">Punjab National Bank</option>
          </select>
        </div>
      </div>

      {/* Bank Share Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {bankStats.map((b) => (
          <div
            key={b.code}
            onClick={() => setSelectedBank(selectedBank === b.code ? "ALL" : b.code)}
            className={`p-3 rounded-2xl border transition-all cursor-pointer ${
              selectedBank === b.code
                ? "bg-[#FAF6EE] border-[#D96B27] shadow-sm"
                : "bg-white border-[#E8E2D5] hover:border-[#D96B27]"
            }`}
          >
            <div className="text-[10px] font-mono font-bold text-[#D96B27]">{b.code}</div>
            <div className="text-xs font-bold text-[#2C2623] truncate mt-0.5">{b.name}</div>
            <div className="text-[11px] text-[#746D65] mt-1 font-mono">{b.share}</div>
          </div>
        ))}
      </div>

      {/* Entities Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">
            Account Entity Profiles & Balance Distribution
          </h3>
          <span className="text-xs text-[#746D65] font-mono">
            Showing {filtered.length} entities
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65]">
                <th className="py-3 px-4">Account ID</th>
                <th className="py-3 px-4">Bank & IFSC Code</th>
                <th className="py-3 px-4">Forensic Entity Category</th>
                <th className="py-3 px-4">Total Inflow</th>
                <th className="py-3 px-4">Total Outflow</th>
                <th className="py-3 px-4">Active Balance</th>
                <th className="py-3 px-4 text-right">Risk Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1] font-mono">
              {filtered.map((e, idx) => (
                <tr key={idx} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3 px-4 font-bold text-[#2C2623]">{e.account}</td>
                  <td className="py-3 px-4 font-sans">
                    <div className="font-semibold text-[#2C2623]">{e.bank}</div>
                    <div className="text-[11px] text-[#9E968D] font-mono">{e.ifsc}</div>
                  </td>
                  <td className="py-3 px-4 font-sans">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      e.type.includes("Victim") ? "bg-[#E6F7F0] text-[#059669]" :
                      e.type.includes("L1") ? "bg-[#FFEDD5] text-[#EA580C]" :
                      e.type.includes("L2") ? "bg-[#FEF3C7] text-[#D97706]" :
                      e.type.includes("L3") ? "bg-[#EDE9FE] text-[#7C3AED]" :
                      "bg-[#F3EDE2] text-[#746D65]"
                    }`}>
                      {e.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#059669]">₹{e.totalIn.toLocaleString('en-IN')}</td>
                  <td className="py-3 px-4 text-[#DC2626]">₹{e.totalOut.toLocaleString('en-IN')}</td>
                  <td className="py-3 px-4 font-bold text-[#2C2623]">₹{e.balance.toLocaleString('en-IN')}</td>
                  <td className="py-3 px-4 text-right font-sans">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      e.risk.includes("HIGH") || e.risk.includes("CRITICAL")
                        ? "bg-[#FEE2E2] text-[#DC2626]"
                        : "bg-[#E6F7F0] text-[#059669]"
                    }`}>
                      {e.risk}
                    </span>
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
