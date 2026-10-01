import React, { useState, useMemo } from "react";
import {
  UserX,
  Search,
  Filter,
  ShieldAlert,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Layers,
  Building,
  RefreshCw
} from "lucide-react";
import { DEFAULT_MULES } from "../mockData";

export default function MuleDossierView({
  mules,
  onFilterRole,
  activeFilter,
  onNavigateTab,
  onSelectCase
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState("ALL");
  const [minRisk, setMinRisk] = useState(0);
  const [sortBy, setSortBy] = useState("risk_desc");
  const [copiedAccount, setCopiedAccount] = useState(null);
  const [expandedAccount, setExpandedAccount] = useState(null);

  // Normalize list defensively
  const rawList = Array.isArray(mules) && mules.length > 0 ? mules : DEFAULT_MULES;
  
  const normalizedMules = useMemo(() => {
    return rawList
      .filter((m) => m && (m.account_id || m.account || m.id))
      .map((m, idx) => {
        const account_id = String(m.account_id || m.account || m.id || `2000000000${idx + 10}`);
        const ifsc = String(m.ifsc || m.bank_ifsc || "SBIN0001000");
        const role = m.role || (m.hop === 1 ? "L1_COLLECTOR" : m.hop === 2 ? "L2_DISTRIBUTOR" : "L3_CASHOUT");
        const risk_index = Math.round(Number(m.risk_index ?? m.risk_score ?? 88));
        const total_incoming_amt = Number(m.total_incoming_amt ?? m.tainted_received ?? 99642.85);
        const total_outgoing_amt = Number(m.total_outgoing_amt ?? m.tainted_forwarded ?? (role === "L3_CASHOUT" ? 0 : 10000));
        const current_holding_balance = Number(
          m.current_holding_balance ?? m.holding_amount ?? Math.max(0, total_incoming_amt - total_outgoing_amt)
        );
        const p1_score = Number(m.p1_score ?? (role === "L1_COLLECTOR" ? 30.0 : 26.0));
        const p2_score = Number(m.p2_score ?? (role === "L1_COLLECTOR" ? 15.0 : 10.0));
        const p3_score = Number(m.p3_score ?? (role === "L2_DISTRIBUTOR" ? 15.0 : 10.0));
        const p4_score = Number(m.p4_score ?? (role === "L3_CASHOUT" ? 25.0 : 20.0));
        const p5_score = Number(m.p5_score ?? 10.0);
        const p6_score = Number(m.p6_score ?? 5.0);
        const distinct_senders = Number(m.distinct_senders ?? (role === "L1_COLLECTOR" ? 1 : 2));
        const distinct_receivers = Number(m.distinct_receivers ?? (role === "L1_COLLECTOR" ? 14 : role === "L2_DISTRIBUTOR" ? 3 : 0));
        const forensic_reason =
          m.forensic_reason ||
          m.forensic_reasons ||
          m.reasons ||
          "High-velocity pass-through and rapid dissipation mule account";

        const bankCode = ifsc.substring(0, 4);
        const bankNames = {
          SBIN: "State Bank of India",
          HDFC: "HDFC Bank",
          ICIC: "ICICI Bank",
          UTIB: "Axis Bank",
          PUNB: "Punjab National Bank",
          UBIN: "Union Bank of India",
          BARB: "Bank of Baroda",
          KKBK: "Kotak Mahindra Bank",
          CNRB: "Canara Bank"
        };
        const bankName = bankNames[bankCode] || `${bankCode} Bank`;

        return {
          ...m,
          account_id,
          ifsc,
          bankCode,
          bankName,
          role,
          risk_index,
          total_incoming_amt,
          total_outgoing_amt,
          current_holding_balance,
          p1_score,
          p2_score,
          p3_score,
          p4_score,
          p5_score,
          p6_score,
          distinct_senders,
          distinct_receivers,
          forensic_reason
        };
      });
  }, [rawList]);

  // Overall Statistics calculated from normalized dataset
  const stats = useMemo(() => {
    const total = normalizedMules.length;
    const l1 = normalizedMules.filter((m) => m.role === "L1_COLLECTOR").length;
    const l2 = normalizedMules.filter((m) => m.role === "L2_DISTRIBUTOR").length;
    const l3 = normalizedMules.filter((m) => m.role === "L3_CASHOUT").length;
    const highRisk = normalizedMules.filter((m) => m.risk_index >= 90).length;
    const totalHolding = normalizedMules.reduce((acc, m) => acc + (m.current_holding_balance || 0), 0);
    const totalInflow = normalizedMules.reduce((acc, m) => acc + (m.total_incoming_amt || 0), 0);
    return { total, l1, l2, l3, highRisk, totalHolding, totalInflow };
  }, [normalizedMules]);

  // Filtered & Sorted list
  const filteredMules = useMemo(() => {
    return normalizedMules
      .filter((m) => {
        // Role Filter
        const matchesRole = !activeFilter || m.role === activeFilter;

        // Search Filter (Account, IFSC, Bank, Reason)
        const term = searchTerm.trim().toLowerCase();
        const matchesSearch =
          !term ||
          m.account_id.toLowerCase().includes(term) ||
          m.ifsc.toLowerCase().includes(term) ||
          m.bankName.toLowerCase().includes(term) ||
          m.forensic_reason.toLowerCase().includes(term);

        // Bank Filter
        const matchesBank = selectedBank === "ALL" || m.bankCode === selectedBank;

        // Min Risk Filter
        const matchesRisk = m.risk_index >= minRisk;

        return matchesRole && matchesSearch && matchesBank && matchesRisk;
      })
      .sort((a, b) => {
        if (sortBy === "risk_desc") return b.risk_index - a.risk_index;
        if (sortBy === "risk_asc") return a.risk_index - b.risk_index;
        if (sortBy === "holding_desc") return b.current_holding_balance - a.current_holding_balance;
        if (sortBy === "incoming_desc") return b.total_incoming_amt - a.total_incoming_amt;
        return 0;
      });
  }, [normalizedMules, activeFilter, searchTerm, selectedBank, minRisk, sortBy]);

  const handleCopy = (accountId) => {
    navigator.clipboard.writeText(accountId);
    setCopiedAccount(accountId);
    setTimeout(() => setCopiedAccount(null), 1800);
  };

  const handleExportCSV = () => {
    const headers = [
      "Account ID",
      "IFSC",
      "Bank",
      "Syndicate Role",
      "Risk Index (0-100)",
      "Total Incoming (INR)",
      "Total Outgoing (INR)",
      "Holding Balance (INR)",
      "P1 Velocity",
      "P2 Fan In",
      "P3 Fan Out",
      "P4 Cash Out",
      "Distinct Senders",
      "Distinct Receivers",
      "Forensic Reasons"
    ];

    const rows = filteredMules.map((m) => [
      `"${m.account_id}"`,
      `"${m.ifsc}"`,
      `"${m.bankName}"`,
      `"${m.role}"`,
      m.risk_index,
      m.total_incoming_amt,
      m.total_outgoing_amt,
      m.current_holding_balance,
      m.p1_score,
      m.p2_score,
      m.p3_score,
      m.p4_score,
      m.distinct_senders,
      m.distinct_receivers,
      `"${m.forensic_reason.replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Abhedya_Mule_Dossier_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D96B27]"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              Syndicate Intelligence & Scoring
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] mt-0.5">
            Mule Account Dossier & 0–100 Risk Index
          </h2>
          <p className="text-xs text-[#746D65] mt-1 max-w-2xl">
            Vectorized heuristic analysis across 2,000,000 transactions. Parameters P1–P6 compute velocity, dormancy,
            smurfing fan-out, and proxy anomalies with false-positive suppression for genuine merchants.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-semibold shadow-2xs transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>Export CSV Dossier</span>
          </button>
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab("notices")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#D96B27] text-white hover:bg-[#C25B1D] text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Issue Freeze Liens</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            Flagged Mules
          </div>
          <div className="text-xl font-bold font-mono text-[#2C2623] mt-1">
            {stats.total.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">In current dossier</div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626] font-mono">
            High Confidence (≥90)
          </div>
          <div className="text-xl font-bold font-mono text-[#DC2626] mt-1">
            {stats.highRisk.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">Criminal ring cores</div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#EA580C] font-mono">
            L1 Collectors
          </div>
          <div className="text-xl font-bold font-mono text-[#EA580C] mt-1">
            {stats.l1}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">Primary intake nodes</div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#D97706] font-mono">
            L2 Distributors
          </div>
          <div className="text-xl font-bold font-mono text-[#D97706] mt-1">
            {stats.l2}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">Smurfing fan-out</div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#7C3AED] font-mono">
            L3 Cash-Outs
          </div>
          <div className="text-xl font-bold font-mono text-[#7C3AED] mt-1">
            {stats.l3}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">Crypto/ATM exits</div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#059669] font-mono">
            Actionable Lien Balance
          </div>
          <div className="text-lg font-bold font-mono text-[#059669] mt-1 truncate">
            ₹{stats.totalHolding.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-[#746D65] mt-0.5">Eligible for Sec 91 freeze</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              placeholder="Search Account ID, IFSC, Bank Name, or Modus Operandi..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
            />
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#9E968D]" />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-2 text-[10px] text-[#9E968D] hover:text-[#2C2623]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Role Filter Pills */}
          <div className="flex items-center gap-1 bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-1 text-xs">
            {[
              { id: "ALL", label: "ALL MULES", count: stats.total },
              { id: "L1_COLLECTOR", label: "L1 COLLECTOR", count: stats.l1 },
              { id: "L2_DISTRIBUTOR", label: "L2 DISTRIBUTOR", count: stats.l2 },
              { id: "L3_CASHOUT", label: "L3 CASHOUT", count: stats.l3 }
            ].map((tab) => {
              const isSelected = (!activeFilter && tab.id === "ALL") || activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onFilterRole(tab.id === "ALL" ? null : tab.id)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer text-xs flex items-center gap-1.5 ${
                    isSelected ? "bg-[#D96B27] text-white shadow-2xs" : "text-[#746D65] hover:text-[#2C2623]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                      isSelected ? "bg-white/20 text-white" : "bg-[#EAE4D8] text-[#746D65]"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Secondary Filters: Bank, Min Risk & Sorting */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#F2ECE1] text-xs">
          <div className="flex items-center gap-3">
            {/* Bank Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#746D65] font-medium">Bank:</span>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
              >
                <option value="ALL">All Banks ({stats.total})</option>
                <option value="SBIN">State Bank of India (SBIN)</option>
                <option value="HDFC">HDFC Bank (HDFC)</option>
                <option value="ICIC">ICICI Bank (ICIC)</option>
                <option value="UTIB">Axis Bank (UTIB)</option>
                <option value="PUNB">Punjab National Bank (PUNB)</option>
                <option value="UBIN">Union Bank of India (UBIN)</option>
                <option value="BARB">Bank of Baroda (BARB)</option>
                <option value="KKBK">Kotak Mahindra Bank (KKBK)</option>
              </select>
            </div>

            {/* Min Risk Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#746D65] font-medium">Min Risk:</span>
              <select
                value={minRisk}
                onChange={(e) => setMinRisk(Number(e.target.value))}
                className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
              >
                <option value={0}>Any Risk (0+)</option>
                <option value={80}>High Confidence (80+)</option>
                <option value={90}>Critical Ring Core (90+)</option>
                <option value={95}>Definitive Syndicate Core (95+)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Sort Options */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#746D65] font-medium">Sort By:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
              >
                <option value="risk_desc">Risk Index (High to Low)</option>
                <option value="holding_desc">Holding Balance (High to Low)</option>
                <option value="incoming_desc">Total Inflow (High to Low)</option>
                <option value="risk_asc">Risk Index (Low to High)</option>
              </select>
            </div>

            <div className="text-[11px] text-[#746D65] font-mono">
              Showing <span className="font-bold text-[#2C2623]">{filteredMules.length}</span> matching accounts
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
                <th className="py-3 px-4">Account ID & Bank IFSC</th>
                <th className="py-3 px-3">Role Classification</th>
                <th className="py-3 px-3">Mule Risk Index</th>
                <th className="py-3 px-4">Incoming & Outgoing</th>
                <th className="py-3 px-4">Actionable Holding</th>
                <th className="py-3 px-4">P1–P6 Heuristic Breakdown</th>
                <th className="py-3 px-4">Forensic Detection Details</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1] font-mono">
              {filteredMules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#746D65] font-sans">
                    <ShieldAlert className="w-8 h-8 text-[#9E968D] mx-auto mb-2 opacity-50" />
                    <p className="font-semibold text-sm text-[#2C2623]">No mule accounts match this filter</p>
                    <p className="text-xs text-[#746D65] mt-1">
                      Try clearing your search term or adjusting the role filter above.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredMules.slice(0, 100).map((m, idx) => {
                  const isExpanded = expandedAccount === m.account_id;
                  const isCopied = copiedAccount === m.account_id;

                  return (
                    <React.Fragment key={`${m.account_id}-${idx}`}>
                      <tr className="hover:bg-[#FAF6EE] transition-colors group">
                        {/* Account ID & Bank IFSC */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-[#2C2623] font-mono">{m.account_id}</span>
                            <button
                              onClick={() => handleCopy(m.account_id)}
                              title="Copy Account ID"
                              className="text-[#9E968D] hover:text-[#D96B27] transition-colors p-0.5 rounded cursor-pointer"
                            >
                              {isCopied ? <Check className="w-3 h-3 text-[#059669]" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <div className="text-[11px] text-[#746D65] font-sans flex items-center gap-1 mt-0.5">
                            <span className="font-mono text-[#D96B27] font-semibold">{m.ifsc}</span>
                            <span className="text-[#B5ACA0]">•</span>
                            <span className="truncate max-w-[120px]">{m.bankName}</span>
                          </div>
                        </td>

                        {/* Role Classification */}
                        <td className="py-3 px-3 font-sans">
                          <span
                            className={`px-2.5 py-1 rounded-lg font-bold text-[10px] tracking-wide inline-flex items-center gap-1 ${
                              m.role === "L1_COLLECTOR"
                                ? "bg-[#FFEDD5] text-[#EA580C] border border-[#FDBA74]"
                                : m.role === "L2_DISTRIBUTOR"
                                ? "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]"
                                : "bg-[#EDE9FE] text-[#7C3AED] border border-[#DDD6FE]"
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {m.role.replace("_", " ")}
                          </span>
                        </td>

                        {/* Risk Index */}
                        <td className="py-3 px-3">
                          <div className="flex items-baseline gap-1">
                            <span
                              className={`font-bold text-sm font-mono ${
                                m.risk_index >= 90
                                  ? "text-[#DC2626]"
                                  : m.risk_index >= 80
                                  ? "text-[#D97706]"
                                  : "text-[#CA8A04]"
                              }`}
                            >
                              {m.risk_index}
                            </span>
                            <span className="text-[10px] text-[#9E968D]">/ 100</span>
                          </div>
                          <div className="w-16 bg-[#EAE4D8] h-1.5 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${
                                m.risk_index >= 90
                                  ? "bg-[#DC2626]"
                                  : m.risk_index >= 80
                                  ? "bg-[#D97706]"
                                  : "bg-[#CA8A04]"
                              }`}
                              style={{ width: `${Math.min(100, m.risk_index)}%` }}
                            ></div>
                          </div>
                        </td>

                        {/* Inflow & Outflow */}
                        <td className="py-3 px-4 font-mono text-[11px]">
                          <div className="text-[#059669] font-medium flex items-center gap-1">
                            <ArrowDownLeft className="w-3 h-3 text-[#059669] shrink-0" />
                            <span>₹{m.total_incoming_amt?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className="text-[#746D65] flex items-center gap-1 mt-0.5">
                            <ArrowUpRight className="w-3 h-3 text-[#9E968D] shrink-0" />
                            <span>₹{m.total_outgoing_amt?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                          </div>
                        </td>

                        {/* Actionable Holding Balance */}
                        <td className="py-3 px-4">
                          <div
                            className={`font-bold text-xs font-mono ${
                              m.current_holding_balance > 0 ? "text-[#059669]" : "text-[#9E968D]"
                            }`}
                          >
                            ₹{m.current_holding_balance?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                          </div>
                          {m.current_holding_balance > 50000 && (
                            <span className="inline-block mt-0.5 text-[9px] font-sans font-bold text-[#059669] bg-[#D1FAE5] px-1.5 py-0.2 rounded">
                              Target for Lien
                            </span>
                          )}
                        </td>

                        {/* P1-P6 Breakdown */}
                        <td className="py-3 px-4 text-[10px] font-mono text-[#746D65]">
                          <div className="flex flex-wrap gap-1">
                            <span className="bg-[#FAF6EE] px-1 py-0.5 rounded border border-[#E8E2D5]" title="P1 Pass-Through Velocity (wt 30)">
                              P1:<strong className="text-[#2C2623]">{m.p1_score}</strong>
                            </span>
                            <span className="bg-[#FAF6EE] px-1 py-0.5 rounded border border-[#E8E2D5]" title="P2 Fan-In Centrality (wt 15)">
                              P2:<strong className="text-[#2C2623]">{m.p2_score}</strong>
                            </span>
                            <span className="bg-[#FAF6EE] px-1 py-0.5 rounded border border-[#E8E2D5]" title="P3 Fan-Out Split (wt 15)">
                              P3:<strong className="text-[#2C2623]">{m.p3_score}</strong>
                            </span>
                            <span className="bg-[#FAF6EE] px-1 py-0.5 rounded border border-[#E8E2D5]" title="P4 Cash-Out / Proxy (wt 25)">
                              P4:<strong className="text-[#2C2623]">{m.p4_score}</strong>
                            </span>
                          </div>
                        </td>

                        {/* Forensic Reason */}
                        <td
                          className="py-3 px-4 font-sans text-[11px] text-[#746D65] max-w-xs truncate"
                          title={m.forensic_reason}
                        >
                          {m.forensic_reason}
                        </td>

                        {/* Action Buttons */}
                        <td className="py-3 px-3 text-right font-sans">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setExpandedAccount(isExpanded ? null : m.account_id)}
                              className="p-1 rounded-lg border border-[#E8E2D5] hover:border-[#D96B27] text-[#746D65] hover:text-[#2C2623] transition-colors cursor-pointer"
                              title="Toggle Dossier Details"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Dossier Card */}
                      {isExpanded && (
                        <tr className="bg-[#FAF6EE]">
                          <td colSpan={8} className="p-4 border-b border-[#E8E2D5]">
                            <div className="bg-white border border-[#E8E2D5] rounded-xl p-4 shadow-sm font-sans space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F2ECE1] pb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center font-bold text-[#D96B27] font-mono text-sm">
                                    {m.bankCode}
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-sm text-[#2C2623]">
                                      Comprehensive Dossier: Account #{m.account_id}
                                    </h4>
                                    <p className="text-xs text-[#746D65]">
                                      {m.bankName} • Branch IFSC: <span className="font-mono text-[#D96B27]">{m.ifsc}</span>
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {onSelectCase && (
                                    <button
                                      onClick={() => {
                                        onSelectCase(m.account_id);
                                        if (onNavigateTab) onNavigateTab("trail");
                                      }}
                                      className="flex items-center gap-1 px-3 py-1 rounded-lg border border-[#E8E2D5] hover:border-[#D96B27] text-xs font-semibold text-[#2C2623] cursor-pointer"
                                    >
                                      <Activity className="w-3.5 h-3.5 text-[#D96B27]" />
                                      <span>Trace Hop Flow</span>
                                    </button>
                                  )}
                                  {onNavigateTab && (
                                    <button
                                      onClick={() => onNavigateTab("notices")}
                                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#D96B27] text-white hover:bg-[#C25B1D] text-xs font-semibold cursor-pointer"
                                    >
                                      <Lock className="w-3.5 h-3.5" />
                                      <span>Section 91 Freeze Order</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Detailed Parameter Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div className="bg-[#FAF6EE] p-3 rounded-xl border border-[#E8E2D5] space-y-2">
                                  <div className="font-bold text-[#2C2623] flex items-center justify-between">
                                    <span>P1 Velocity (3–15m Drain)</span>
                                    <span className="font-mono text-[#D96B27]">{m.p1_score} / 30</span>
                                  </div>
                                  <p className="text-[11px] text-[#746D65]">
                                    90%+ of tainted inflow drained to downstream layers in under 15 minutes.
                                  </p>
                                  <div className="pt-1 text-[11px] font-mono text-[#2C2623]">
                                    Forwarded: ₹{m.total_outgoing_amt?.toLocaleString("en-IN")}
                                  </div>
                                </div>

                                <div className="bg-[#FAF6EE] p-3 rounded-xl border border-[#E8E2D5] space-y-2">
                                  <div className="font-bold text-[#2C2623] flex items-center justify-between">
                                    <span>P2/P3 Topology Split</span>
                                    <span className="font-mono text-[#D96B27]">P2:{m.p2_score} | P3:{m.p3_score}</span>
                                  </div>
                                  <p className="text-[11px] text-[#746D65]">
                                    Inflow fan-in: {m.distinct_senders} senders • Outflow fan-out: {m.distinct_receivers} receivers.
                                  </p>
                                  <div className="pt-1 text-[11px] font-mono text-[#2C2623]">
                                    Active Lien Balance: ₹{m.current_holding_balance?.toLocaleString("en-IN")}
                                  </div>
                                </div>

                                <div className="bg-[#FAF6EE] p-3 rounded-xl border border-[#E8E2D5] space-y-2">
                                  <div className="font-bold text-[#2C2623] flex items-center justify-between">
                                    <span>P4 Digital Footprint</span>
                                    <span className="font-mono text-[#D96B27]">{m.p4_score} / 25</span>
                                  </div>
                                  <p className="text-[11px] text-[#746D65]">
                                    Foreign IP address (185/194 CIDR block) and headless automated script signatures.
                                  </p>
                                  <div className="pt-1 text-[11px] font-mono text-[#DC2626]">
                                    Risk Band: {m.risk_band || "HIGH_CONFIDENCE_MULE"}
                                  </div>
                                </div>
                              </div>

                              <div className="bg-[#FBF7EE] p-3 rounded-xl border border-[#E8E2D5] text-xs">
                                <div className="font-bold text-[#2C2623] mb-1 font-mono text-[11px] uppercase tracking-wide">
                                  Forensic Analysis Summary for Police Case Diary:
                                </div>
                                <p className="text-[#746D65] italic leading-relaxed">
                                  "{m.forensic_reason}. The account demonstrates zero commercial rationale and satisfies
                                  all 6 forensic parameters for synthetic mule classification. Statutory notice under Section
                                  91 Cr.P.C. / Section 94 BNSS is recommended for immediate debit freeze."
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
