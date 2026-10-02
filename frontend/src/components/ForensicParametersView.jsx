import React, { useState, useEffect, useMemo } from "react";
import {
  SlidersHorizontal,
  ShieldCheck,
  Zap,
  Filter,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Building,
  GitCommit,
  Clock,
  Coins,
  Cpu,
  Globe,
  Radio,
  FileText,
  TrendingUp,
  Sliders,
  ChevronRight,
  Eye,
  Info
} from "lucide-react";

export default function ForensicParametersView({
  forensicParams,
  onSaveParams,
  activeCase = "PUNB10000001",
  onNavigateTab,
  onSelectCase
}) {
  // PRD Baseline Defaults
  const prdDefaults = {
    // Traversal & Filtering Constraints
    minAmount: 0,
    maxHops: 4,
    timeWindow: 180, // minutes
    bankFilter: "ALL",
    minRisk: 0,
    narrationKeyword: "",
    deviceFilter: "ALL",

    // PRD Heuristics Weights (Sum = 100)
    p1Weight: 30, // Pass-Through Velocity
    p1VelocityThresholdPct: 85, // % forwarded
    p1WindowMinutes: 15, // 3-15 min window

    p2Weight: 15, // Fan-In Centrality
    p2MinSenders: 3, // Min distinct senders in burst

    p3Weight: 15, // Fan-Out Smurfing Split
    p3MinSplits: 3, // Min downstream recipients

    p4Weight: 25, // Cash-Out & Anomaly Markers (Crypto, Foreign IPs, Headless)
    p4CryptoOfframp: true,
    p4ForeignIpProxy: true,
    p4HeadlessEmulator: true,

    p5Weight: 10, // Shared Cluster & Device Anomaly
    p6Weight: 5,  // Behavioral Dormancy Awakening

    // PRD P7: Heavy Whale Outlier Threshold (INR)
    p7WhaleThreshold: 15000000, // ₹1.5 Crore

    // PRD Phase 2: False Positive Guard (Two-Signal Merchant Protection)
    merchantProtectionGuard: true
  };

  const [formState, setFormState] = useState(() => ({
    ...prdDefaults,
    ...(forensicParams || {})
  }));

  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (forensicParams) {
      setFormState((prev) => ({
        ...prev,
        ...forensicParams
      }));
    }
  }, [forensicParams]);

  const formatRupee = (val) => {
    const num = Number(val) || 0;
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)} L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(0)}K`;
    if (num > 0) return `₹${num.toLocaleString("en-IN")}`;
    return "All Amounts (₹0+)";
  };

  // Compute total heuristic weight
  const totalWeight = useMemo(() => {
    return (
      (Number(formState.p1Weight) || 0) +
      (Number(formState.p2Weight) || 0) +
      (Number(formState.p3Weight) || 0) +
      (Number(formState.p4Weight) || 0) +
      (Number(formState.p5Weight) || 0) +
      (Number(formState.p6Weight) || 0)
    );
  }, [
    formState.p1Weight,
    formState.p2Weight,
    formState.p3Weight,
    formState.p4Weight,
    formState.p5Weight,
    formState.p6Weight
  ]);

  // Active filters count
  const activeConstraintCount = useMemo(() => {
    let count = 0;
    if (Number(formState.minAmount) > 0) count++;
    if (Number(formState.maxHops) !== 4) count++;
    if (Number(formState.timeWindow) !== 180) count++;
    if (formState.bankFilter && formState.bankFilter !== "ALL") count++;
    if (Number(formState.minRisk) > 0) count++;
    if (formState.narrationKeyword && formState.narrationKeyword.trim() !== "") count++;
    if (formState.deviceFilter && formState.deviceFilter !== "ALL") count++;
    if (Number(formState.p7WhaleThreshold) !== 15000000) count++;
    if (!formState.merchantProtectionGuard) count++;
    return count;
  }, [formState]);

  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (onSaveParams) {
      onSaveParams(formState);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleResetToDefaults = () => {
    setFormState(prdDefaults);
    if (onSaveParams) {
      onSaveParams(prdDefaults);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 pb-12 select-none">
      {/* Top Header Banner */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#D96B27] via-[#E88C4D] to-[#2C2623]" />
        
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[#D96B27]">
                <SlidersHorizontal className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-serif font-bold text-[#2C2623]">
                    Forensic Investigation Parameters & Heuristics Setup
                  </h1>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                    PRD P1–P10 Specification
                  </span>
                </div>
                <p className="text-xs text-[#7C746D]">
                  Configure multi-hop money trail thresholds, 0–100 Mule Risk Index heuristics, whale triggers, and false-positive merchant guards. Changes dynamically filter active investigations and future CSV/Google Sheet ingests.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E8E2D5] bg-[#FAF6EE] text-xs font-mono text-[#7C746D] hover:text-[#2C2623] hover:bg-[#F3EDE2] transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to PRD Baseline</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-mono font-semibold shadow-xs transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Save & Apply Parameters</span>
            </button>
          </div>
        </div>

        {/* Live Saved Notification Banner */}
        {savedSuccess && (
          <div className="mt-4 p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-between text-xs text-[#065F46] animate-in fade-in duration-200">
            <div className="flex items-center gap-2 font-mono">
              <CheckCircle2 className="w-4 h-4 text-[#059669]" />
              <span><strong>Parameters Successfully Saved & Propagated:</strong> Multi-hop trail, mule dossiers, entity directory, and 60s fraud scanner have been re-filtered.</span>
            </div>
            <span className="text-[10px] font-mono text-[#059669]">Status: Active & Enforced</span>
          </div>
        )}
      </div>

      {/* KPI Status Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-[#9E968D] text-xs font-mono mb-1">
            <span>ACTIVE FILTER CONSTRAINTS</span>
            <Filter className="w-4 h-4 text-[#D96B27]" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2C2623]">
            {activeConstraintCount}{" "}
            <span className="text-xs font-mono text-[#7C746D] font-normal">
              {activeConstraintCount === 0 ? "(Baseline PRD)" : "Customized"}
            </span>
          </div>
          <div className="text-[11px] text-[#9E968D] mt-1 font-mono">
            {formState.bankFilter !== "ALL" ? `Routing: ${formState.bankFilter}` : "All Banks Covered"}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-[#9E968D] text-xs font-mono mb-1">
            <span>MIN TXN THRESHOLD</span>
            <Coins className="w-4 h-4 text-[#D96B27]" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#D96B27]">
            {formatRupee(formState.minAmount)}
          </div>
          <div className="text-[11px] text-[#9E968D] mt-1 font-mono">
            Downstream BFS pruning floor
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-[#9E968D] text-xs font-mono mb-1">
            <span>MAX HOP DEPTH & VELOCITY</span>
            <GitCommit className="w-4 h-4 text-[#D96B27]" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2C2623]">
            {formState.maxHops} Hops{" "}
            <span className="text-xs font-mono text-[#7C746D] font-normal">
              / {formState.timeWindow}m
            </span>
          </div>
          <div className="text-[11px] text-[#9E968D] mt-1 font-mono">
            L1 Collector → L2 Distributor → L3 Cash-out
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-[#9E968D] text-xs font-mono mb-1">
            <span>P1–P6 HEURISTIC WEIGHT SUM</span>
            <TrendingUp className="w-4 h-4 text-[#D96B27]" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2C2623]">
            {totalWeight}{" "}
            <span className={`text-xs font-mono font-normal ${totalWeight === 100 ? "text-[#059669]" : "text-[#D97706]"}`}>
              / 100 Max Score {totalWeight === 100 ? "✓" : "(!)"}
            </span>
          </div>
          <div className="text-[11px] text-[#9E968D] mt-1 font-mono">
            {formState.merchantProtectionGuard ? "Merchant Guard: Active" : "Merchant Guard: Off"}
          </div>
        </div>
      </div>

      {/* Main Form Workstation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Controls (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* SECTION 1: Investigation & Multi-Hop Traversal Constraints */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#EFEAE1] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#FAF6EE] text-[#D96B27] flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <h2 className="text-sm font-serif font-bold text-[#2C2623]">
                  Investigation & Multi-Hop Traversal Constraints
                </h2>
              </div>
              <span className="text-[10px] font-mono text-[#9E968D]">
                Affects: Graph Traversal & Ingestion Pipeline
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Min Transaction Amount */}
              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>MINIMUM TRANSACTION AMOUNT FILTER (INR)</span>
                  <span className="text-[#D96B27] font-bold">{formatRupee(formState.minAmount)}</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-[#9E968D] font-mono">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formState.minAmount}
                    onChange={(e) => setFormState({ ...formState, minAmount: Number(e.target.value) || 0 })}
                    placeholder="Enter minimum INR threshold (e.g. 50000 or 15000000)"
                    className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl pl-7 pr-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                  />
                </div>
                {/* Presets */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { label: "All Amounts (₹0)", val: 0 },
                    { label: "₹50,000", val: 50000 },
                    { label: "₹1,00,000", val: 100000 },
                    { label: "₹10,00,000", val: 1000000 },
                    { label: "₹1 Crore+", val: 10000000 },
                    { label: "₹2–3 Cr Whale", val: 20000000 }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setFormState({ ...formState, minAmount: preset.val })}
                      className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                        Number(formState.minAmount) === preset.val
                          ? "bg-[#D96B27] text-white border-[#D96B27] font-semibold"
                          : "bg-[#FAF6EE] text-[#746D65] border-[#E8E2D5] hover:bg-[#F3EDE2]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Hop Depth */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>MAX HOP DEPTH</span>
                  <span className="text-[#D96B27] font-bold">{formState.maxHops} Hops</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((hop) => (
                    <button
                      key={hop}
                      type="button"
                      onClick={() => setFormState({ ...formState, maxHops: hop })}
                      className={`py-2 text-xs font-mono rounded-xl border text-center font-bold transition-all cursor-pointer ${
                        Number(formState.maxHops) === hop
                          ? "bg-[#2C2623] text-white border-[#2C2623]"
                          : "bg-[#FAF6EE] text-[#746D65] border-[#E8E2D5] hover:bg-[#F3EDE2]"
                      }`}
                    >
                      {hop}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#9E968D] font-mono">
                  1: Immediate recipient | 2: Bunny hop distributors | 3-5: Terminal cash-outs
                </p>
              </div>

              {/* Velocity Dispersion Window */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>VELOCITY DISPERSION WINDOW</span>
                  <span className="text-[#D96B27] font-bold">{formState.timeWindow} Mins</span>
                </div>
                <select
                  value={formState.timeWindow}
                  onChange={(e) => setFormState({ ...formState, timeWindow: Number(e.target.value) })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                >
                  <option value={15}>15 Mins (Rapid Automated Burst)</option>
                  <option value={30}>30 Mins (High-Speed Slicing)</option>
                  <option value={60}>60 Mins (Standard Tactical Scan)</option>
                  <option value={180}>180 Mins (3h Standard Investigation)</option>
                  <option value={720}>720 Mins (12h Multi-Shift Window)</option>
                  <option value={1440}>1440 Mins (24h Full Day Cycle)</option>
                </select>
                <p className="text-[10px] text-[#9E968D] font-mono">
                  Time constraint between incoming and outgoing transactions
                </p>
              </div>

              {/* Bank / IFSC Routing Filter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>BANK / IFSC ROUTING</span>
                  <span className="text-[#D96B27] font-bold">{formState.bankFilter}</span>
                </div>
                <select
                  value={formState.bankFilter}
                  onChange={(e) => setFormState({ ...formState, bankFilter: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                >
                  <option value="ALL">All Banks (Multi-Bank Aggregation)</option>
                  <option value="PYTM">Paytm Payments Bank (PYTM)</option>
                  <option value="IPOS">India Post Payments Bank (IPOS)</option>
                  <option value="AXIS">Axis Bank (AXIS)</option>
                  <option value="SBIN">State Bank of India (SBIN)</option>
                  <option value="PUNB">Punjab National Bank (PUNB)</option>
                  <option value="HDFC">HDFC Bank (HDFC)</option>
                  <option value="ICIC">ICICI Bank (ICIC)</option>
                  <option value="KKBK">Kotak Mahindra Bank (KKBK)</option>
                </select>
              </div>

              {/* Minimum Mule Risk Score */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>MINIMUM MULE RISK INDEX</span>
                  <span className="text-[#D96B27] font-bold">{formState.minRisk}+ / 100</span>
                </div>
                <select
                  value={formState.minRisk}
                  onChange={(e) => setFormState({ ...formState, minRisk: Number(e.target.value) })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                >
                  <option value={0}>0+ (All Transacting Accounts)</option>
                  <option value={35}>35+ (Suspected Mules & Up)</option>
                  <option value={65}>65+ (High-Confidence Mules Only)</option>
                  <option value={85}>85+ (Critical High-Risk Syndicate)</option>
                  <option value={95}>95+ (Definite Terminal Cash-Out Nodes)</option>
                </select>
              </div>

              {/* Scam Narration Keywords */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>SCAM / NARRATION KEYWORD TRIGGER</span>
                  <span className="text-[#D96B27] font-bold">
                    {formState.narrationKeyword || "Any"}
                  </span>
                </div>
                <input
                  type="text"
                  value={formState.narrationKeyword}
                  onChange={(e) => setFormState({ ...formState, narrationKeyword: e.target.value })}
                  placeholder="e.g. CRYPTO, TASK, ARREST, BETTING, IPO"
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                />
              </div>

              {/* Telemetry & Device Filter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono font-medium text-[#746D65]">
                  <span>IP & DEVICE TELEMETRY</span>
                  <span className="text-[#D96B27] font-bold">{formState.deviceFilter}</span>
                </div>
                <select
                  value={formState.deviceFilter}
                  onChange={(e) => setFormState({ ...formState, deviceFilter: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                >
                  <option value="ALL">All Network Traffic</option>
                  <option value="HEADLESS">Headless Emulators & Bots Only</option>
                  <option value="FOREIGN_IP">Foreign Proxy IPs (185.* / 194.*)</option>
                  <option value="SUSPICIOUS">Combined Anomaly Traffic</option>
                </select>
              </div>
            </div>
          </div>

          {/* SECTION 2: PRD Heuristic Weights Setup (P1 to P6) */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#EFEAE1] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#FAF6EE] text-[#D96B27] flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <h2 className="text-sm font-serif font-bold text-[#2C2623]">
                  PRD Heuristic Weights & Detection Thresholds (P1–P6)
                </h2>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                totalWeight === 100
                  ? "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]"
                  : "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]"
              }`}>
                Total Weight: {totalWeight} / 100
              </span>
            </div>

            <div className="space-y-3.5">
              {/* P1: Pass-Through Velocity */}
              <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P1: Pass-Through Velocity</span>
                    <span className="text-[10px] text-[#7C746D]">Forwarded &gt;= 85% within 3–15 mins</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-[#9E968D]">Weight:</span>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={formState.p1Weight}
                      onChange={(e) => setFormState({ ...formState, p1Weight: Number(e.target.value) || 0 })}
                      className="w-14 bg-white border border-[#E8E2D5] rounded-lg px-2 py-0.5 text-center font-bold text-[#D96B27] focus:outline-none focus:border-[#D96B27]"
                    />
                    <span className="text-[#9E968D]">pts</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={formState.p1Weight}
                  onChange={(e) => setFormState({ ...formState, p1Weight: Number(e.target.value) || 0 })}
                  className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                />
              </div>

              {/* P2: Fan-In Centrality */}
              <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P2: Fan-In Centrality</span>
                    <span className="text-[10px] text-[#7C746D]">Distinct victim senders into account in short burst</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-[#9E968D]">Weight:</span>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      value={formState.p2Weight}
                      onChange={(e) => setFormState({ ...formState, p2Weight: Number(e.target.value) || 0 })}
                      className="w-14 bg-white border border-[#E8E2D5] rounded-lg px-2 py-0.5 text-center font-bold text-[#D96B27] focus:outline-none focus:border-[#D96B27]"
                    />
                    <span className="text-[#9E968D]">pts</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={formState.p2Weight}
                  onChange={(e) => setFormState({ ...formState, p2Weight: Number(e.target.value) || 0 })}
                  className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                />
              </div>

              {/* P3: Fan-Out Smurfing Split */}
              <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P3: Fan-Out Smurfing Split</span>
                    <span className="text-[10px] text-[#7C746D]">Rapid 3–50 outbound split structuring</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-[#9E968D]">Weight:</span>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      value={formState.p3Weight}
                      onChange={(e) => setFormState({ ...formState, p3Weight: Number(e.target.value) || 0 })}
                      className="w-14 bg-white border border-[#E8E2D5] rounded-lg px-2 py-0.5 text-center font-bold text-[#D96B27] focus:outline-none focus:border-[#D96B27]"
                    />
                    <span className="text-[#9E968D]">pts</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={formState.p3Weight}
                  onChange={(e) => setFormState({ ...formState, p3Weight: Number(e.target.value) || 0 })}
                  className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                />
              </div>

              {/* P4: Cash-Out & Anomaly Markers */}
              <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P4: Cash-Out & Anomaly Markers</span>
                    <span className="text-[10px] text-[#7C746D]">Foreign proxy IPs (185/194), headless scripts, crypto P2P</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-[#9E968D]">Weight:</span>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      value={formState.p4Weight}
                      onChange={(e) => setFormState({ ...formState, p4Weight: Number(e.target.value) || 0 })}
                      className="w-14 bg-white border border-[#E8E2D5] rounded-lg px-2 py-0.5 text-center font-bold text-[#D96B27] focus:outline-none focus:border-[#D96B27]"
                    />
                    <span className="text-[#9E968D]">pts</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={formState.p4Weight}
                  onChange={(e) => setFormState({ ...formState, p4Weight: Number(e.target.value) || 0 })}
                  className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                />
              </div>

              {/* P5 & P6: Shared Cluster and Dormancy */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P5: Shared Cluster Anomaly</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={formState.p5Weight}
                      onChange={(e) => setFormState({ ...formState, p5Weight: Number(e.target.value) || 0 })}
                      className="w-12 bg-white border border-[#E8E2D5] rounded-lg px-1.5 py-0.5 text-center font-bold text-[#D96B27] text-xs focus:outline-none focus:border-[#D96B27]"
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={formState.p5Weight}
                    onChange={(e) => setFormState({ ...formState, p5Weight: Number(e.target.value) || 0 })}
                    className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                  />
                </div>

                <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-[#2C2623]">P6: Dormancy Awakening</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={formState.p6Weight}
                      onChange={(e) => setFormState({ ...formState, p6Weight: Number(e.target.value) || 0 })}
                      className="w-12 bg-white border border-[#E8E2D5] rounded-lg px-1.5 py-0.5 text-center font-bold text-[#D96B27] text-xs focus:outline-none focus:border-[#D96B27]"
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={formState.p6Weight}
                    onChange={(e) => setFormState({ ...formState, p6Weight: Number(e.target.value) || 0 })}
                    className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: PRD P7 Whale Threshold & False-Positive Guard */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#EFEAE1] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#FAF6EE] text-[#D96B27] flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <h2 className="text-sm font-serif font-bold text-[#2C2623]">
                  Syndicate Whale Traps & Merchant False-Positive Guard
                </h2>
              </div>
              <span className="text-[10px] font-mono text-[#9E968D]">
                PRD Phase 2 Specifications
              </span>
            </div>

            <div className="space-y-4">
              {/* P7 Heavy Whale Outlier Threshold */}
              <div className="p-4 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono font-bold text-[#2C2623]">
                      P7: Heavy Whale Outlier Threshold (INR)
                    </div>
                    <div className="text-[11px] text-[#7C746D]">
                      Transactions at or above this threshold trigger priority Section 91 rapid lien requisitions.
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#D96B27]">
                    {formatRupee(formState.p7WhaleThreshold)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1000000"
                    step="1000000"
                    value={formState.p7WhaleThreshold}
                    onChange={(e) => setFormState({ ...formState, p7WhaleThreshold: Number(e.target.value) || 15000000 })}
                    className="w-full bg-white border border-[#E8E2D5] rounded-xl px-3 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                  />
                  <div className="flex gap-1 shrink-0 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, p7WhaleThreshold: 5000000 })}
                      className="px-2 py-1.5 rounded-lg bg-white border border-[#E8E2D5] hover:bg-[#F3EDE2]"
                    >
                      ₹50 Lakh
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, p7WhaleThreshold: 15000000 })}
                      className="px-2 py-1.5 rounded-lg bg-white border border-[#E8E2D5] hover:bg-[#F3EDE2]"
                    >
                      ₹1.5 Cr (PRD)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, p7WhaleThreshold: 30000000 })}
                      className="px-2 py-1.5 rounded-lg bg-white border border-[#E8E2D5] hover:bg-[#F3EDE2]"
                    >
                      ₹3.0 Cr
                    </button>
                  </div>
                </div>
              </div>

              {/* Two-Signal False Positive Guard */}
              <div className="p-4 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#059669]" />
                    <span className="text-xs font-mono font-bold text-[#2C2623]">
                      Two-Signal False-Positive Merchant Guard (PRD Phase 2)
                    </span>
                  </div>
                  <p className="text-[11px] text-[#7C746D]">
                    Protects legitimate high-volume merchants from false-positive freezing requisitions. Suppresses alert if high inflow account has 0 cash-out anomalies and 0 rapid outbound dissipations.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={formState.merchantProtectionGuard}
                    onChange={(e) => setFormState({ ...formState, merchantProtectionGuard: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E8E2D5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#E8E2D5] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#059669]"></div>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Working & Active Case Impact (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Active Case Live Preview Card */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#EFEAE1] pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#D96B27]" />
                <h3 className="text-xs font-serif font-bold text-[#2C2623] uppercase tracking-wider">
                  Live Engine Impact
                </h3>
              </div>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                Real-Time BFS
              </span>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-1">
                <div className="text-[10px] text-[#9E968D]">TARGET INVESTIGATION CASE</div>
                <div className="font-bold text-[#2C2623] flex items-center justify-between">
                  <span>{activeCase}</span>
                  <span className="text-[10px] text-[#059669] bg-[#ECFDF5] px-1.5 py-0.5 rounded">Active Anchor</span>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#7C746D]">Downstream Filter Floor:</span>
                  <span className="font-bold text-[#D96B27]">{formatRupee(formState.minAmount)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#7C746D]">Max Hop Traversal:</span>
                  <span className="font-bold text-[#2C2623]">{formState.maxHops} Hops</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#7C746D]">Velocity Window:</span>
                  <span className="font-bold text-[#2C2623]">{formState.timeWindow} Mins</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#7C746D]">Bank Route Enforced:</span>
                  <span className="font-bold text-[#2C2623]">{formState.bankFilter}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#7C746D]">Min Mule Risk Cutoff:</span>
                  <span className="font-bold text-[#2C2623]">{formState.minRisk}+ / 100</span>
                </div>
              </div>

              {/* Quick Navigation links to observe changes */}
              <div className="pt-3 border-t border-[#EFEAE1] space-y-2">
                <div className="text-[10px] font-bold text-[#9E968D] uppercase tracking-wider">
                  Observe Working On:
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab("trail")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#2C2623] text-xs font-mono transition-all text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <GitCommit className="w-3.5 h-3.5 text-[#D96B27]" />
                    <span>Endpoint Money Trail</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#9E968D]" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab("dossier")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#2C2623] text-xs font-mono transition-all text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-[#D96B27]" />
                    <span>0–100 Mule Dossier</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#9E968D]" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab("scanner")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#2C2623] text-xs font-mono transition-all text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-[#D96B27]" />
                    <span>60s Fraud Scanner</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#9E968D]" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab && onNavigateTab("intake")}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F3EDE2] text-[#2C2623] text-xs font-mono transition-all text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Building className="w-3.5 h-3.5 text-[#D96B27]" />
                    <span>Ingest Pipeline (CSV/Sheet)</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#9E968D]" />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Guidance Info Box */}
          <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-2xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 font-serif font-bold text-[#2C2623]">
              <Info className="w-4 h-4 text-[#D96B27]" />
              <span>How This Works</span>
            </div>
            <p className="text-[11px] text-[#7C746D] leading-relaxed">
              When you click <strong>"Save & Apply Parameters"</strong>, these values are written to local persistent storage and applied to DuckDB graph queries.
            </p>
            <p className="text-[11px] text-[#7C746D] leading-relaxed">
              If you upload a 2-million record CSV or paste a cyber crime Google Sheet URL, these parameters act as an immediate filter, isolating suspicious money dissipations in sub-seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
