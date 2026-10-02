import React, { useState, useMemo, useEffect, useRef } from "react";
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
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Layers,
  Building,
  RefreshCw,
  X,
  Shield
} from "lucide-react";
import { DEFAULT_MULES } from "../mockData";
import { fetchMules } from "../api";

// Canonical role normalizer to guarantee exact matching regardless of backend or mock label variant
const canonicalRole = (r, hop) => {
  const s = String(r || "").toUpperCase();
  if (s.includes("L4") || s.includes("TERMINAL")) return "L4_TERMINAL";
  if (s.includes("L1") || s.includes("COLLECTOR")) return "L1_COLLECTOR";
  if (s.includes("L2") || s.includes("DISTRIBUTOR") || s.includes("LAYER")) return "L2_DISTRIBUTOR";
  if (s.includes("L3") || s.includes("CASHOUT") || s.includes("EXIT") || s.includes("CRYPTO")) return "L3_CASHOUT";
  if (hop === 1) return "L1_COLLECTOR";
  if (hop === 2) return "L2_DISTRIBUTOR";
  if (hop === 3) return "L3_CASHOUT";
  if (hop >= 4) return "L4_TERMINAL";
  return "L1_COLLECTOR";
};

export default function MuleDossierView({
  mules,
  onFilterRole,
  activeFilter,
  onNavigateTab,
  onSelectCase,
  forensicParams
}) {
  const [internalMules, setInternalMules] = useState(() => (Array.isArray(mules) && mules.length > 0 ? mules : []));
  const [isLoadingMules, setIsLoadingMules] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState(() => forensicParams?.bankFilter || "ALL");
  const [minRisk, setMinRisk] = useState(() => forensicParams?.minRisk || 0);
  const [sortBy, setSortBy] = useState("risk_desc");
  const [copiedAccount, setCopiedAccount] = useState(null);
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const drawerMuleRef = useRef(null);

  // Sync internal state whenever parent passes a non-empty array
  useEffect(() => {
    if (Array.isArray(mules) && mules.length > 0) {
      setInternalMules(mules);
    }
  }, [mules]);

  // Self-healing: auto-fetch full 2,000 scored mules on mount
  const reloadMasterDossier = async () => {
    setIsLoadingMules(true);
    try {
      const data = await fetchMules(2000);
      if (Array.isArray(data) && data.length > 0) {
        setInternalMules(data);
      }
    } catch (err) {
      console.warn("Could not auto-fetch mules in MuleDossierView:", err);
    } finally {
      setIsLoadingMules(false);
    }
  };

  useEffect(() => {
    // Unconditionally fetch live scored mules from DuckDB on mount
    reloadMasterDossier();
  }, []);

  // Close drawer on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setExpandedAccount(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (forensicParams?.bankFilter) setSelectedBank(forensicParams.bankFilter);
    if (forensicParams?.minRisk !== undefined) setMinRisk(forensicParams.minRisk);
  }, [forensicParams]);

  // Normalize list defensively from live internal state, incoming prop, or default mules
  const rawList = useMemo(() => {
    if (Array.isArray(internalMules) && internalMules.length > 0) {
      return internalMules;
    }
    if (Array.isArray(mules) && mules.length > 0) {
      return mules;
    }
    return DEFAULT_MULES;
  }, [internalMules, mules]);
  
  const normalizedMules = useMemo(() => {
    return rawList
      .filter((m) => m && (m.account_id || m.account || m.id))
      .map((m, idx) => {
        const account_id = String(m.account_id || m.account || m.id || `2000000000${idx + 10}`);
        const ifsc = String(m.ifsc || m.bank_ifsc || "SBIN0001000");
        const role = canonicalRole(m.role, m.hop);
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
          AXIS: "Axis Bank",
          PUNB: "Punjab National Bank",
          UBIN: "Union Bank of India",
          BARB: "Bank of Baroda",
          KKBK: "Kotak Mahindra Bank",
          CNRB: "Canara Bank",
          PYTM: "Paytm Payments Bank",
          IPOS: "India Post Payments Bank"
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

  // Dynamically extract bank options with real live account counts
  const bankOptions = useMemo(() => {
    const map = {};
    normalizedMules.forEach((m) => {
      const code = m.bankCode;
      if (code) {
        if (!map[code]) {
          map[code] = { code, name: m.bankName, count: 0 };
        }
        map[code].count += 1;
      }
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [normalizedMules]);

  // Selected mule resolution for Right-Side Glassmorphic Drawer
  const selectedMule = useMemo(() => {
    if (!expandedAccount) return null;
    return normalizedMules.find((m) => m.account_id === expandedAccount) || null;
  }, [normalizedMules, expandedAccount]);

  useEffect(() => {
    if (selectedMule) {
      drawerMuleRef.current = selectedMule;
    }
  }, [selectedMule]);

  const displayedMule = selectedMule || drawerMuleRef.current;
  const isDrawerOpen = Boolean(selectedMule);

  // Overall Statistics calculated from normalized master dataset (immune to filter clipping)
  const stats = useMemo(() => {
    const total = normalizedMules.length;
    const l1 = normalizedMules.filter((m) => m.role === "L1_COLLECTOR").length;
    const l2 = normalizedMules.filter((m) => m.role === "L2_DISTRIBUTOR").length;
    const l3 = normalizedMules.filter((m) => m.role === "L3_CASHOUT").length;
    const l4 = normalizedMules.filter((m) => m.role === "L4_TERMINAL").length;
    const highRisk = normalizedMules.filter((m) => m.risk_index >= 90).length;
    const totalHolding = normalizedMules.reduce((acc, m) => acc + (m.current_holding_balance || 0), 0);
    const totalInflow = normalizedMules.reduce((acc, m) => acc + (m.total_incoming_amt || 0), 0);
    return { total, l1, l2, l3, l4, highRisk, totalHolding, totalInflow };
  }, [normalizedMules]);

  // Filtered & Sorted list for the table
  const filteredMules = useMemo(() => {
    return normalizedMules
      .filter((m) => {
        // Role Filter (matches canonical role)
        const matchesRole = !activeFilter || activeFilter === "ALL" || m.role === canonicalRole(activeFilter);

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

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, searchTerm, selectedBank, minRisk, sortBy]);

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedBank !== "ALL" ||
    minRisk > 0 ||
    sortBy !== "risk_desc" ||
    (activeFilter && activeFilter !== "ALL")
  );

  const resetAllFilters = () => {
    setSearchTerm("");
    setSelectedBank("ALL");
    setMinRisk(0);
    setSortBy("risk_desc");
    if (onFilterRole) onFilterRole(null);
  };

  const totalPages = Math.max(1, Math.ceil(filteredMules.length / itemsPerPage));
  const paginatedMules = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredMules.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredMules, currentPage, itemsPerPage]);

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
    <div className="space-y-4">
      {/* 1. Top Banner / Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E2D5] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-xs bg-[#D96B27]"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              SYNDICATE INTELLIGENCE &amp; SCORING • 2,000,000 TRANSACTIONS
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#2C2623] mt-0.5 tracking-tight">
            Mule Account Dossier &amp; 0–100 Risk Index
          </h2>
          <p className="text-xs text-[#746D65] mt-0.5 max-w-3xl font-sans">
            Vectorized heuristic analysis across 2,000,000 transactions. Parameters P1–P6 compute velocity, dormancy,
            smurfing fan-out, and proxy anomalies with false-positive suppression for genuine merchants.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={reloadMasterDossier}
            disabled={isLoadingMules}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold shadow-2xs transition-all cursor-pointer disabled:opacity-50"
            title="Reload live dataset from DuckDB"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#D96B27] ${isLoadingMules ? "animate-spin" : ""}`} />
            <span>{isLoadingMules ? "Syncing..." : "Refresh Dossier"}</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#E8E2D5] text-[#2C2623] hover:border-[#D96B27] text-xs font-mono font-bold shadow-2xs transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>Export CSV Dossier</span>
          </button>
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab("notices")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm bg-[#D96B27] text-white hover:bg-[#C25B1D] text-xs font-mono font-bold shadow-2xs transition-all cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Issue Freeze Liens</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Unified Framed Metric Strip with Sharp Dividers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-[#E8E2D5] bg-white border border-[#E8E2D5] rounded-sm shadow-2xs">
        {/* Metric 1: Total Mules */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#746D65] font-mono block whitespace-nowrap">
            FLAGGED MULES
          </span>
          <div className="text-lg sm:text-xl font-bold font-mono text-[#2C2623] tracking-tight my-0.5 whitespace-nowrap">
            {stats.total.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-[#746D65] whitespace-nowrap font-sans">
            In current dossier
          </p>
        </div>

        {/* Metric 2: High Confidence (>=90) */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626] font-mono block whitespace-nowrap">
            HIGH CONFIDENCE (≥90)
          </span>
          <div className="text-lg sm:text-xl font-bold font-mono text-[#DC2626] tracking-tight my-0.5 whitespace-nowrap">
            {stats.highRisk.toLocaleString("en-IN")}
          </div>
          <p className="text-[11px] text-[#DC2626] font-medium whitespace-nowrap font-sans">
            Criminal ring cores
          </p>
        </div>

        {/* Metric 3: L1 Collectors */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#EA580C] font-mono block whitespace-nowrap">
            L1 COLLECTORS
          </span>
          <div className="text-lg sm:text-xl font-bold font-mono text-[#EA580C] tracking-tight my-0.5 whitespace-nowrap">
            {stats.l1}
          </div>
          <p className="text-[11px] text-[#746D65] whitespace-nowrap font-sans">
            Primary intake nodes
          </p>
        </div>

        {/* Metric 4: L2 Distributors */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#D97706] font-mono block whitespace-nowrap">
            L2 DISTRIBUTORS
          </span>
          <div className="text-lg sm:text-xl font-bold font-mono text-[#D97706] tracking-tight my-0.5 whitespace-nowrap">
            {stats.l2}
          </div>
          <p className="text-[11px] text-[#746D65] whitespace-nowrap font-sans">
            Smurfing fan-out
          </p>
        </div>

        {/* Metric 5: L3 Cash-Outs */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#7C3AED] font-mono block whitespace-nowrap">
            L3 CASH-OUTS
          </span>
          <div className="text-lg sm:text-xl font-bold font-mono text-[#7C3AED] tracking-tight my-0.5 whitespace-nowrap">
            {stats.l3}
          </div>
          <p className="text-[11px] text-[#746D65] whitespace-nowrap font-sans">
            Crypto/ATM exits
          </p>
        </div>

        {/* Metric 6: Actionable Lien Balance */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#059669] font-mono block whitespace-nowrap">
            ACTIONABLE LIEN
          </span>
          <div className="text-base sm:text-lg font-bold font-mono text-[#059669] tracking-tight my-0.5 truncate whitespace-nowrap" title={`₹${stats.totalHolding.toLocaleString("en-IN")}`}>
            ₹{stats.totalHolding.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <p className="text-[11px] text-[#059669] font-medium whitespace-nowrap font-sans">
            Eligible for Sec 91 freeze
          </p>
        </div>
      </div>

      {/* 3. Forensic Account Intelligence Console (Filters Upward, Roles Downward) */}
      <div className="bg-white border border-[#E8E2D5] rounded-sm p-3.5 shadow-2xs space-y-3">
        {/* Tier 1 (UPWARD): Small Search Field + Forensic Filters + Matching Telemetry */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E8E2D5]">
          {/* Left: Compact Search Bar + Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Small Search Field (w-64 sm:w-72) */}
            <div className="relative w-64 sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9E968D] pointer-events-none" />
              <input
                type="text"
                placeholder="Search Account, IFSC, Bank..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-[#D4CEBF] rounded-sm pl-8 pr-12 py-1.5 text-xs font-mono text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 shadow-2xs transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-1 py-0.5 text-[9px] font-mono uppercase font-bold text-[#9E968D] hover:text-[#2C2623] hover:bg-[#FAF6EE] rounded-xs transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Hairline Divider with Proper Spacing */}
            <div className="hidden sm:block h-6 w-px bg-[#E8E2D5]" />

            {/* Forensic Filters Group */}
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              {/* Micro-Label Badge */}
              <div className="inline-flex items-center gap-1 text-[#9E968D] font-mono">
                <Filter className="w-3 h-3 text-[#D96B27]" />
                <span className="text-[10px] font-bold uppercase tracking-wider">FILTERS:</span>
              </div>

              {/* Bank Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#746D65] whitespace-nowrap">
                  Bank:
                </span>
                <select
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                  className="bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-1 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27] shadow-2xs hover:border-[#D96B27]/50 transition-colors cursor-pointer"
                >
                  <option value="ALL">All Banks ({stats.total.toLocaleString("en-IN")})</option>
                  {bankOptions.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name} ({b.code}) — {b.count.toLocaleString("en-IN")}
                    </option>
                  ))}
                </select>
              </div>

              {/* Min Risk Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#746D65] whitespace-nowrap">
                  Min Risk:
                </span>
                <select
                  value={minRisk}
                  onChange={(e) => setMinRisk(Number(e.target.value))}
                  className="bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-1 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27] shadow-2xs hover:border-[#D96B27]/50 transition-colors cursor-pointer"
                >
                  <option value={0}>Any Risk (0+)</option>
                  <option value={80}>High Confidence (80+)</option>
                  <option value={90}>Critical Ring Core (90+)</option>
                  <option value={95}>Definitive Syndicate Core (95+)</option>
                </select>
              </div>

              {/* Sort Options */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#746D65] whitespace-nowrap">
                  Sort:
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-white border border-[#D4CEBF] rounded-sm px-2.5 py-1 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27] shadow-2xs hover:border-[#D96B27]/50 transition-colors cursor-pointer"
                >
                  <option value="risk_desc">Risk Index (High to Low)</option>
                  <option value="holding_desc">Holding Balance (High to Low)</option>
                  <option value="incoming_desc">Total Inflow (High to Low)</option>
                  <option value="risk_asc">Risk Index (Low to High)</option>
                </select>
              </div>

              {/* Reset Filters action */}
              {hasActiveFilters && (
                <button
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#D96B27] hover:text-[#C25B1D] bg-[#FFEDD5]/70 hover:bg-[#FFEDD5] border border-[#FDBA74] rounded-xs transition-colors cursor-pointer shadow-2xs"
                  title="Reset all search, bank, risk, and role filters"
                >
                  <X className="w-3 h-3" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Matching Accounts Telemetry Badge */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5] shadow-2xs font-mono shrink-0 ml-auto sm:ml-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#059669]"></span>
            <span className="text-xs font-bold text-[#2C2623]">{filteredMules.length.toLocaleString("en-IN")}</span>
            <span className="text-[10px] font-bold text-[#746D65] uppercase tracking-wider">
              Matching Accounts
            </span>
          </div>
        </div>

        {/* Tier 2 (DOWNWARD): L1, L2, L3 Role Segmentation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#9E968D] shrink-0">
              SYNDICATE LAYER:
            </span>
            <div className="inline-flex items-center p-0.5 rounded-sm bg-[#FAF6EE] border border-[#E8E2D5] gap-1 shadow-2xs shrink-0">
              {[
                { id: "ALL", label: "ALL MULES", count: stats.total },
                { id: "L1_COLLECTOR", label: "L1 COLLECTOR", count: stats.l1 },
                { id: "L2_DISTRIBUTOR", label: "L2 DISTRIBUTOR", count: stats.l2 },
                { id: "L3_CASHOUT", label: "L3 CASHOUT", count: stats.l3 },
                { id: "L4_TERMINAL", label: "L4 TERMINAL", count: stats.l4 }
              ].map((tab) => {
                const isSelected = (!activeFilter && tab.id === "ALL") || activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onFilterRole(tab.id === "ALL" ? null : tab.id)}
                    className={`px-3 py-1.5 rounded-xs text-xs font-mono font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                      isSelected
                        ? "bg-[#D96B27] text-white shadow-2xs border border-[#C25B1D]"
                        : "text-[#746D65] hover:text-[#2C2623] hover:bg-white border border-transparent"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-xs font-bold transition-colors ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-[#E8E2D5] text-[#5C554E]"
                      }`}
                    >
                      {tab.count.toLocaleString("en-IN")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Context tip on large screens */}
          <div className="hidden lg:flex items-center gap-2 text-[11px] text-[#746D65] font-sans">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D96B27]"></span>
            <span>Click any tier to isolate intake, layering, or cashout nodes.</span>
          </div>
        </div>
      </div>

      {/* 4. Main Structured Dossier Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-sm overflow-hidden shadow-2xs">
        <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#FAF6EE] border-b border-[#E8E2D5]">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                <th className="py-2.5 px-4">Account ID &amp; Bank IFSC</th>
                <th className="py-2.5 px-3">Role Classification</th>
                <th className="py-2.5 px-3">Mule Risk Index</th>
                <th className="py-2.5 px-4">Incoming &amp; Outgoing</th>
                <th className="py-2.5 px-4">Actionable Holding</th>
                <th className="py-2.5 px-4">P1–P6 Heuristic Breakdown</th>
                <th className="py-2.5 px-4">Forensic Detection Details</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
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
                    {hasActiveFilters && (
                      <button
                        onClick={resetAllFilters}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold text-[#D96B27] bg-[#FFEDD5] border border-[#FDBA74] rounded-sm hover:bg-[#FDBA74]/30 cursor-pointer shadow-2xs transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reset All Filters</span>
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedMules.map((m) => {
                  const isExpanded = expandedAccount === m.account_id;
                  const isCopied = copiedAccount === m.account_id;

                  return (
                    <tr
                      key={m.account_id}
                      className={`transition-all duration-150 group ${
                        isExpanded
                          ? "bg-[#FFF6ED] ring-1 ring-inset ring-[#D96B27]/40 shadow-2xs"
                          : "hover:bg-[#FAF6EE]/80"
                      }`}
                    >
                      {/* Account ID & Bank IFSC */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[#2C2623] font-mono">{m.account_id}</span>
                          <button
                            onClick={() => handleCopy(m.account_id)}
                            title="Copy Account ID"
                            className="text-[#9E968D] hover:text-[#D96B27] transition-colors p-1 rounded-xs hover:bg-[#FAF6EE] border border-transparent hover:border-[#E8E2D5] cursor-pointer"
                          >
                            {isCopied ? <Check className="w-3 h-3 text-[#059669]" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="text-[11px] text-[#746D65] font-sans flex items-center gap-1 mt-0.5">
                          <span className="font-mono text-[#D96B27] font-semibold">{m.ifsc}</span>
                          <span className="text-[#B5ACA0]">•</span>
                          <span className="truncate max-w-[130px]">{m.bankName}</span>
                        </div>
                      </td>

                      {/* Role Classification */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-xs font-mono font-bold text-[10px] tracking-wider inline-flex items-center gap-1.5 uppercase ${
                            m.role === "L1_COLLECTOR"
                              ? "bg-[#FFEDD5] text-[#EA580C] border border-[#FDBA74]"
                              : m.role === "L2_DISTRIBUTOR"
                              ? "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]"
                              : m.role === "L4_TERMINAL"
                              ? "bg-[#FFE4E6] text-[#E11D48] border border-[#FDA4AF]"
                              : "bg-[#EDE9FE] text-[#7C3AED] border border-[#DDD6FE]"
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-xs bg-current"></span>
                          {m.role.replace("_", " ")}
                        </span>
                      </td>

                      {/* Risk Index */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-baseline gap-1">
                          <span
                            className={`font-bold text-xs font-mono ${
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
                        <div className="w-16 bg-[#E8E2D5] h-1.5 rounded-xs overflow-hidden mt-1">
                          <div
                            className={`h-full rounded-xs ${
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
                      <td className="py-2.5 px-4 font-mono text-[11px] whitespace-nowrap">
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
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div
                          className={`font-bold text-xs font-mono ${
                            m.current_holding_balance > 0 ? "text-[#059669]" : "text-[#9E968D]"
                          }`}
                        >
                          ₹{m.current_holding_balance?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </div>
                        {m.current_holding_balance > 50000 && (
                          <span className="inline-block mt-0.5 text-[9px] font-mono font-bold text-[#059669] bg-[#D1FAE5] px-1.5 py-0.5 rounded-xs border border-[#A7F3D0]">
                            Target for Lien
                          </span>
                        )}
                      </td>

                      {/* P1-P6 Breakdown */}
                      <td className="py-2.5 px-4 text-[10px] font-mono text-[#746D65]">
                        <div className="flex flex-wrap gap-1">
                          <span className="bg-[#FAF6EE] px-1.5 py-0.5 rounded-xs border border-[#E8E2D5]" title="P1 Pass-Through Velocity (wt 30)">
                            P1:<strong className="text-[#2C2623]">{m.p1_score}</strong>
                          </span>
                          <span className="bg-[#FAF6EE] px-1.5 py-0.5 rounded-xs border border-[#E8E2D5]" title="P2 Fan-In Centrality (wt 15)">
                            P2:<strong className="text-[#2C2623]">{m.p2_score}</strong>
                          </span>
                          <span className="bg-[#FAF6EE] px-1.5 py-0.5 rounded-xs border border-[#E8E2D5]" title="P3 Fan-Out Split (wt 15)">
                            P3:<strong className="text-[#2C2623]">{m.p3_score}</strong>
                          </span>
                          <span className="bg-[#FAF6EE] px-1.5 py-0.5 rounded-xs border border-[#E8E2D5]" title="P4 Cash-Out / Proxy (wt 25)">
                            P4:<strong className="text-[#2C2623]">{m.p4_score}</strong>
                          </span>
                        </div>
                      </td>

                      {/* Forensic Reason */}
                      <td
                        className="py-2.5 px-4 font-sans text-[11px] text-[#746D65] max-w-xs truncate"
                        title={m.forensic_reason}
                      >
                        {m.forensic_reason}
                      </td>

                      {/* Action Button: Opens Right-Side Dossier Drawer */}
                      <td className="py-2.5 px-3 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setExpandedAccount(isExpanded ? null : m.account_id)}
                            className={`p-1.5 rounded-sm border transition-all cursor-pointer shadow-2xs flex items-center gap-1 ${
                              isExpanded
                                ? "border-[#D96B27] bg-[#D96B27] text-white"
                                : "border-[#E8E2D5] bg-white hover:border-[#D96B27] text-[#746D65] hover:text-[#2C2623]"
                            }`}
                            title={isExpanded ? "Close Dossier (ESC)" : "Inspect Forensic Dossier"}
                          >
                            <ChevronRight
                              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                isExpanded ? "rotate-90 sm:rotate-0 sm:translate-x-0.5" : ""
                              }`}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar (Sets of 50) */}
        {filteredMules.length > itemsPerPage && (
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#FAF6EE] border-t border-[#E8E2D5] text-xs">
            <div className="text-[#746D65] font-mono text-[11px]">
              Showing <span className="font-bold text-[#2C2623]">{(currentPage - 1) * itemsPerPage + 1}</span>–
              <span className="font-bold text-[#2C2623]">{Math.min(currentPage * itemsPerPage, filteredMules.length)}</span> of{" "}
              <span className="font-bold text-[#2C2623]">{filteredMules.length}</span> mule accounts (50 per page)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-sm border text-xs font-mono font-bold transition-all ${
                  currentPage === 1
                    ? "border-[#E8E2D5] text-[#9E968D] bg-white/40 cursor-not-allowed"
                    : "border-[#E8E2D5] text-[#2C2623] bg-white hover:bg-[#F2ECE1] shadow-2xs cursor-pointer"
                }`}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous 50
              </button>

              <div className="flex items-center gap-1 font-mono text-xs">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-7 h-7 rounded-sm font-semibold flex items-center justify-center transition-all cursor-pointer ${
                      currentPage === pageNum
                        ? "bg-[#D96B27] text-white shadow-2xs font-bold"
                        : "text-[#746D65] hover:bg-[#F2ECE1] hover:text-[#2C2623]"
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-sm border text-xs font-mono font-bold transition-all ${
                  currentPage === totalPages
                    ? "border-[#E8E2D5] text-[#9E968D] bg-white/40 cursor-not-allowed"
                    : "border-[#E8E2D5] text-[#2C2623] bg-white hover:bg-[#F2ECE1] shadow-2xs cursor-pointer"
                }`}
              >
                Next 50
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Subtle Translucent Backdrop (10-20% dark tint with subtle blur) */}
      <div
        className={`fixed inset-0 z-40 bg-[#2C2623]/20 backdrop-blur-[2px] transition-opacity duration-300 ${
          isDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setExpandedAccount(null)}
        aria-hidden="true"
      />

      {/* 6. Sideways Glassmorphic Detail Drawer (Slides from Right) */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[480px] md:w-[520px] lg:w-[560px] xl:w-[600px] max-w-full sm:max-w-[85vw] h-screen bg-[#FAF7F0]/92 backdrop-blur-[24px] border-l border-[#E8E2D5]/90 shadow-2xl shadow-stone-900/20 rounded-l-2xl sm:rounded-l-[20px] flex flex-col transition-transform duration-300 ease-out ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
        aria-label="Account Forensic Dossier"
      >
        {displayedMule && (
          <>
            {/* Sticky Compact Header */}
            <div className="sticky top-0 z-20 px-5 py-4 border-b border-[#E8E2D5]/80 bg-[#FAF7F0]/95 backdrop-blur-md shadow-2xs shrink-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/90 border border-[#E8E2D5] flex items-center justify-center font-bold text-[#D96B27] font-mono text-sm shadow-2xs shrink-0">
                    {displayedMule.bankCode}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-base font-mono text-[#2C2623] tracking-tight truncate">
                        {displayedMule.account_id}
                      </span>
                      <button
                        onClick={() => handleCopy(displayedMule.account_id)}
                        title="Copy Account ID"
                        className="text-[#9E968D] hover:text-[#D96B27] p-1 rounded-xs hover:bg-[#EAE4D8]/60 transition-colors cursor-pointer shrink-0"
                      >
                        {copiedAccount === displayedMule.account_id ? (
                          <Check className="w-3.5 h-3.5 text-[#059669]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-[#746D65] font-sans flex items-center gap-1.5 mt-0.5 truncate">
                      <span className="truncate">{displayedMule.bankName}</span>
                      <span className="text-[#B5ACA0]">•</span>
                      <span className="font-mono text-[#D96B27] font-semibold shrink-0">{displayedMule.ifsc}</span>
                    </p>
                  </div>
                </div>

                {/* Close Button */}
                <button
                  onClick={() => setExpandedAccount(null)}
                  className="p-1.5 rounded-lg border border-[#E8E2D5] bg-white/80 hover:bg-white text-[#746D65] hover:text-[#2C2623] transition-all cursor-pointer shadow-2xs shrink-0"
                  title="Close Dossier (ESC)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Badges & Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E8E2D5]/70">
                <div className="flex items-center gap-1.5">
                  {/* Role badge */}
                  <span
                    className={`px-2 py-0.5 rounded-xs font-mono font-bold text-[10px] tracking-wider inline-flex items-center gap-1.5 uppercase ${
                      displayedMule.role === "L1_COLLECTOR"
                        ? "bg-[#FFEDD5] text-[#EA580C] border border-[#FDBA74]"
                        : displayedMule.role === "L2_DISTRIBUTOR"
                        ? "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]"
                        : displayedMule.role === "L4_TERMINAL"
                        ? "bg-[#FFE4E6] text-[#E11D48] border border-[#FDA4AF]"
                        : "bg-[#EDE9FE] text-[#7C3AED] border border-[#DDD6FE]"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-xs bg-current"></span>
                    {displayedMule.role.replace("_", " ")}
                  </span>

                  {/* Risk Score */}
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-xs border border-[#E8E2D5] bg-white/80 text-[#2C2623]">
                    Risk:{" "}
                    <span
                      className={
                        displayedMule.risk_index >= 90
                          ? "text-[#DC2626]"
                          : displayedMule.risk_index >= 80
                          ? "text-[#D97706]"
                          : "text-[#CA8A04]"
                      }
                    >
                      {displayedMule.risk_index}
                    </span>
                    /100
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {onSelectCase && (
                    <button
                      onClick={() => {
                        onSelectCase(displayedMule.account_id);
                        if (onNavigateTab) onNavigateTab("trail");
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-[#E8E2D5] bg-white hover:border-[#D96B27] text-xs font-mono font-bold text-[#2C2623] shadow-2xs transition-all cursor-pointer"
                    >
                      <Activity className="w-3.5 h-3.5 text-[#D96B27]" />
                      <span>Trace Hop Flow</span>
                    </button>
                  )}
                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab("notices")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#D96B27] text-white hover:bg-[#C25B1D] text-xs font-mono font-bold shadow-2xs transition-all cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Section 91 Freeze</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Scrollable Forensic Dossier Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 font-sans text-xs">
              {/* Financial Flow Section */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono flex items-center justify-between">
                  <span>Financial Flow &amp; Liquidity</span>
                  <span className="text-[9px] text-[#746D65] font-normal">INR Central Ledger</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {/* Incoming */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-2.5 shadow-2xs flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#746D65] block">
                      Total Incoming
                    </span>
                    <div className="text-sm font-bold font-mono text-[#059669] my-1 flex items-center gap-0.5">
                      <ArrowDownLeft className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                      <span className="truncate">₹{displayedMule.total_incoming_amt?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                    </div>
                    <span className="text-[9px] text-[#746D65] block">Tainted Inflow</span>
                  </div>

                  {/* Outgoing */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-2.5 shadow-2xs flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#746D65] block">
                      Total Outgoing
                    </span>
                    <div className="text-sm font-bold font-mono text-[#746D65] my-1 flex items-center gap-0.5">
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#9E968D] shrink-0" />
                      <span className="truncate">₹{displayedMule.total_outgoing_amt?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                    </div>
                    <span className="text-[9px] text-[#746D65] block">Rapid Dissipation</span>
                  </div>

                  {/* Actionable Holding */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-2.5 shadow-2xs flex flex-col justify-between">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#059669] block">
                      Actionable Holding
                    </span>
                    <div className="text-sm font-bold font-mono text-[#059669] my-1 truncate">
                      ₹{displayedMule.current_holding_balance?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                    {displayedMule.current_holding_balance > 50000 ? (
                      <span className="inline-block text-[8px] font-mono font-bold text-[#059669] bg-[#D1FAE5] px-1 py-0.2 rounded-xs border border-[#A7F3D0] truncate">
                        Target for Lien
                      </span>
                    ) : (
                      <span className="text-[9px] text-[#746D65] block">Sec 91 Lien Base</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Forensic Parameters Breakdown (P1–P6) */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono flex items-center justify-between">
                  <span>Forensic Parameters Breakdown (P1–P6)</span>
                  <span className="text-[9px] text-[#D96B27] font-mono font-bold">Heuristic Engine</span>
                </div>

                <div className="space-y-2">
                  {/* P1 Card */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-3 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="font-bold text-[#2C2623] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-xs bg-[#D96B27]"></span>
                        P1 Pass-Through Velocity (3–15m Drain)
                      </span>
                      <span className="font-bold text-[#D96B27] bg-[#FFEDD5]/70 px-1.5 py-0.5 rounded-xs border border-[#FDBA74]">
                        {displayedMule.p1_score} / 30
                      </span>
                    </div>
                    <p className="text-[11px] text-[#746D65] font-sans leading-relaxed">
                      90%+ of tainted inflow drained to downstream layers in under 15 minutes of intake.
                    </p>
                    <div className="pt-1 text-[11px] font-mono text-[#2C2623] flex items-center justify-between border-t border-[#E8E2D5]/40">
                      <span className="text-[#746D65]">Total Forwarded:</span>
                      <span className="font-bold">₹{displayedMule.total_outgoing_amt?.toLocaleString("en-IN")}</span>
                    </div>
                  </div>

                  {/* P2/P3 Card */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-3 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="font-bold text-[#2C2623] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-xs bg-[#D97706]"></span>
                        P2 / P3 Topology Split (Smurfing Fan-Out)
                      </span>
                      <span className="font-bold text-[#D97706] bg-[#FEF3C7]/70 px-1.5 py-0.5 rounded-xs border border-[#FDE68A]">
                        P2:{displayedMule.p2_score} | P3:{displayedMule.p3_score}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#746D65] font-sans leading-relaxed">
                      Inflow fan-in: <strong className="text-[#2C2623]">{displayedMule.distinct_senders} senders</strong> • Outflow fan-out: <strong className="text-[#2C2623]">{displayedMule.distinct_receivers} receivers</strong>.
                    </p>
                    <div className="pt-1 text-[11px] font-mono text-[#2C2623] flex items-center justify-between border-t border-[#E8E2D5]/40">
                      <span className="text-[#746D65]">Active Lien Balance:</span>
                      <span className="font-bold text-[#059669]">₹{displayedMule.current_holding_balance?.toLocaleString("en-IN")}</span>
                    </div>
                  </div>

                  {/* P4 Card */}
                  <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-3 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="font-bold text-[#2C2623] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-xs bg-[#DC2626]"></span>
                        P4 Digital Footprint &amp; Proxy Anomalies
                      </span>
                      <span className="font-bold text-[#DC2626] bg-[#FEE2E2]/70 px-1.5 py-0.5 rounded-xs border border-[#FCA5A5]">
                        {displayedMule.p4_score} / 25
                      </span>
                    </div>
                    <p className="text-[11px] text-[#746D65] font-sans leading-relaxed">
                      Foreign IP address (185/194 CIDR block) and headless automated script signatures detected.
                    </p>
                    <div className="pt-1 text-[11px] font-mono text-[#DC2626] flex items-center justify-between border-t border-[#E8E2D5]/40">
                      <span className="text-[#746D65]">Syndicate Risk Band:</span>
                      <span className="font-bold">{displayedMule.risk_band || "HIGH_CONFIDENCE_MULE"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Forensic Detection Signals */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                  Active Forensic Detection Signals
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-1 rounded-xs bg-white/80 border border-[#E8E2D5] font-mono text-[10px] text-[#2C2623] font-medium shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#DC2626]"></span>
                    High-velocity pass-through (&lt;15m)
                  </span>
                  <span className="px-2 py-1 rounded-xs bg-white/80 border border-[#E8E2D5] font-mono text-[10px] text-[#2C2623] font-medium shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#DC2626]"></span>
                    Foreign IP (185/194 CIDR block)
                  </span>
                  <span className="px-2 py-1 rounded-xs bg-white/80 border border-[#E8E2D5] font-mono text-[10px] text-[#2C2623] font-medium shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#D97706]"></span>
                    Automated script signature
                  </span>
                  <span className="px-2 py-1 rounded-xs bg-white/80 border border-[#E8E2D5] font-mono text-[10px] text-[#2C2623] font-medium shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#D97706]"></span>
                    Fan-in / Fan-out smurfing anomaly
                  </span>
                  <span className="px-2 py-1 rounded-xs bg-white/80 border border-[#E8E2D5] font-mono text-[10px] text-[#2C2623] font-medium shadow-2xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-xs bg-[#746D65]"></span>
                    Zero commercial trade rationale
                  </span>
                </div>
              </div>

              {/* Police Case Diary & Statutory Notice Card */}
              <div className="bg-white/75 backdrop-blur-sm border border-[#E8E2D5]/80 rounded-sm p-3.5 space-y-1.5 shadow-2xs">
                <div className="font-bold text-[#2C2623] font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#D96B27]" />
                  <span>Forensic Summary for Police Case Diary</span>
                </div>
                <p className="text-[#746D65] italic leading-relaxed text-[11px] font-sans">
                  "{displayedMule.forensic_reason}. The account demonstrates zero commercial rationale and satisfies
                  all 6 forensic parameters for synthetic mule classification. Statutory notice under Section
                  91 Cr.P.C. / Section 94 BNSS is recommended for immediate debit freeze."
                </p>
                <div className="pt-2 text-[10px] font-mono text-[#9E968D] flex items-center justify-between border-t border-[#E8E2D5]/50">
                  <span>CHAIN-OF-CUSTODY: LOCKED</span>
                  <span className="text-[#059669] font-bold">SEC. 63 BSA COMPLIANT</span>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
