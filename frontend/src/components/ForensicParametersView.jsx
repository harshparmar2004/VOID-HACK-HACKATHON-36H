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
  Plus,
  Trash2,
  Check,
  Copy,
  Terminal,
  Database,
  Search,
  Eye,
  ArrowRight,
  Layers,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  HelpCircle
} from "lucide-react";
import { simulateParameters } from "../api";

export default function ForensicParametersView({
  forensicParams = {},
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
    timeWindow: 180,
    bankFilter: "ALL",
    minRisk: 0,
    narrationKeyword: "",
    deviceFilter: "ALL",

    // PRD Heuristics Weights (Sum = 100)
    p1Weight: 30,
    p2Weight: 15,
    p3Weight: 15,
    p4Weight: 25,
    p5Weight: 10,
    p6Weight: 5,

    // PRD P7 Whale Outlier Threshold
    p7WhaleThreshold: 15000000, // ₹1.5 Cr

    // False Positive Merchant Protection
    merchantProtectionGuard: true,

    // Dynamic Custom Rules Array
    customRules: [
      {
        id: "rule_crypto_p2p",
        name: "Crypto P2P Narration Detector",
        field: "Narration",
        operator: "contains",
        value: "CRYPTO",
        action: "FLAG_SUSPICIOUS",
        enabled: true
      },
      {
        id: "rule_foreign_proxy",
        name: "Foreign Proxy IP Subnet",
        field: "IP_Address",
        operator: "starts_with",
        value: "194.",
        action: "AUTO_FREEZE",
        enabled: true
      }
    ]
  };

  const [formState, setFormState] = useState(() => ({
    ...prdDefaults,
    ...(forensicParams || {}),
    customRules: forensicParams?.customRules || prdDefaults.customRules
  }));

  const [activeTab, setActiveTab] = useState("traversal"); // 'traversal' | 'custom' | 'heuristics' | 'simulation'
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [simulationData, setSimulationData] = useState(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (forensicParams) {
      setFormState((prev) => ({
        ...prev,
        ...forensicParams,
        customRules: forensicParams.customRules || prev.customRules || prdDefaults.customRules
      }));
    }
  }, [forensicParams]);

  // Run simulation whenever parameters change or on mount
  const runLiveSimulation = async (stateToSimulate = formState) => {
    setSimulating(true);
    try {
      const res = await simulateParameters({
        min_amount: stateToSimulate.minAmount,
        bank_filter: stateToSimulate.bankFilter,
        keyword: stateToSimulate.narrationKeyword,
        device_filter: stateToSimulate.deviceFilter,
        min_risk: stateToSimulate.minRisk,
        custom_rules: stateToSimulate.customRules,
        active_case: activeCase
      });
      if (res && res.status === "success") {
        setSimulationData(res);
      }
    } catch (e) {
      console.warn("Could not simulate parameters:", e);
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    runLiveSimulation(formState);
  }, []);

  const formatRupee = (val) => {
    const num = Number(val) || 0;
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)} L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(0)}K`;
    if (num > 0) return `₹${num.toLocaleString("en-IN")}`;
    return "All Amounts (₹0+)";
  };

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

  const activeCustomRulesCount = useMemo(() => {
    return (formState.customRules || []).filter((r) => r.enabled).length;
  }, [formState.customRules]);

  // Handle Save
  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (onSaveParams) {
      onSaveParams(formState);
    }
    setSavedSuccess(true);
    runLiveSimulation(formState);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  // Reset to Baseline
  const handleReset = () => {
    setFormState(prdDefaults);
    if (onSaveParams) {
      onSaveParams(prdDefaults);
    }
    setSavedSuccess(true);
    runLiveSimulation(prdDefaults);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  // Custom Rules Operations
  const handleAddCustomRule = () => {
    const newRule = {
      id: `rule_${Date.now()}`,
      name: `Custom Rule #${(formState.customRules?.length || 0) + 1}`,
      field: "Narration",
      operator: "contains",
      value: "",
      action: "FLAG_SUSPICIOUS",
      enabled: true
    };
    const updated = {
      ...formState,
      customRules: [...(formState.customRules || []), newRule]
    };
    setFormState(updated);
    setActiveTab("custom");
  };

  const handleUpdateRule = (index, field, val) => {
    const updatedRules = [...(formState.customRules || [])];
    updatedRules[index] = {
      ...updatedRules[index],
      [field]: val
    };
    setFormState({
      ...formState,
      customRules: updatedRules
    });
  };

  const handleDeleteRule = (index) => {
    const updatedRules = (formState.customRules || []).filter((_, i) => i !== index);
    setFormState({
      ...formState,
      customRules: updatedRules
    });
  };

  const handleToggleRule = (index) => {
    const updatedRules = [...(formState.customRules || [])];
    updatedRules[index] = {
      ...updatedRules[index],
      enabled: !updatedRules[index].enabled
    };
    setFormState({
      ...formState,
      customRules: updatedRules
    });
  };

  // Quick Preset Rule Templates
  const handleApplyPresetTemplate = (template) => {
    const newRule = {
      id: `rule_${Date.now()}`,
      ...template,
      enabled: true
    };
    setFormState({
      ...formState,
      customRules: [...(formState.customRules || []), newRule]
    });
  };

  return (
    <div className="space-y-5 pb-12 select-none">
      {/* Top Command Header Bar */}
      <div className="bg-[#1C1917] text-white rounded-2xl p-5 shadow-sm border border-[#2E2824] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-ping" />
            <span className="text-[10px] font-mono tracking-widest uppercase text-[#A8A29E] font-semibold">
              Forensic Intelligence Hub • Type-Safe JEV Sorter
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#D96B27] text-white">
              PRD P1–P10 Engine
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Investigation Parameters & Dynamic Rule Studio</span>
          </h1>
          <p className="text-xs text-[#A8A29E] max-w-3xl">
            Configure multi-hop BFS money trail bounds, add custom investigative parameter rules, adjust 0–100 Mule Risk Index heuristics, and execute live simulations across 2,000,000 banking records.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleAddCustomRule}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2A2420] hover:bg-[#38312B] border border-[#443B34] text-xs font-semibold text-[#E7E5E4] transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>Add Custom Rule</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-transparent hover:bg-[#2A2420] border border-[#443B34] text-xs font-mono text-[#A8A29E] hover:text-white transition-all cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Baseline</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-md transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Save & Apply Parameters</span>
          </button>
        </div>
      </div>

      {/* Confirmation Notification Banner */}
      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-between text-xs text-[#065F46] animate-in fade-in duration-150">
          <div className="flex items-center gap-2 font-mono">
            <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" />
            <span>
              <strong>Parameters & Custom Rules Enforced:</strong> All active graph money trails, mule dossiers, entity directory queries, and future CSV/Google Sheet ingests are immediately re-filtered.
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold text-[#059669] bg-white px-2 py-0.5 rounded border border-[#A7F3D0]">
            ACTIVE & ENFORCED
          </span>
        </div>
      )}

      {/* Real-Time Metrics Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white border border-[#E8E2D5] rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#78716C] mb-1">
            <span>FILTERED MATCHES</span>
            <Database className="w-3.5 h-3.5 text-[#D96B27]" />
          </div>
          <div className="text-xl font-bold font-mono text-[#1C1917]">
            {simulationData ? simulationData.total_matching_txns.toLocaleString("en-IN") : "..."}{" "}
            <span className="text-[11px] font-normal text-[#78716C]">Txns</span>
          </div>
          <div className="text-[10px] text-[#A8A29E] font-mono mt-0.5">
            Vol: {simulationData ? `₹${(simulationData.total_matching_volume / 100000).toFixed(2)} Lakh` : "..."}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#78716C] mb-1">
            <span>ACTIVE CUSTOM RULES</span>
            <Zap className="w-3.5 h-3.5 text-[#D96B27]" />
          </div>
          <div className="text-xl font-bold font-mono text-[#1C1917]">
            {activeCustomRulesCount}{" "}
            <span className="text-[11px] font-normal text-[#78716C]">
              / {formState.customRules?.length || 0} Enabled
            </span>
          </div>
          <div className="text-[10px] text-[#A8A29E] font-mono mt-0.5">
            User-defined parameters
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#78716C] mb-1">
            <span>MULTI-HOP BOUNDS</span>
            <GitCommit className="w-3.5 h-3.5 text-[#D96B27]" />
          </div>
          <div className="text-xl font-bold font-mono text-[#1C1917]">
            {formState.maxHops} Hops{" "}
            <span className="text-[11px] font-normal text-[#78716C]">
              / {formState.timeWindow}m
            </span>
          </div>
          <div className="text-[10px] text-[#A8A29E] font-mono mt-0.5">
            Min Floor: {formatRupee(formState.minAmount)}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#78716C] mb-1">
            <span>PRD HEURISTIC WEIGHT</span>
            <TrendingUp className="w-3.5 h-3.5 text-[#D96B27]" />
          </div>
          <div className="text-xl font-bold font-mono text-[#1C1917]">
            {totalWeight}{" "}
            <span className={`text-[11px] font-normal ${totalWeight === 100 ? "text-[#059669]" : "text-[#D97706]"}`}>
              / 100 {totalWeight === 100 ? "✓ Optimal" : "(!)"}
            </span>
          </div>
          <div className="text-[10px] text-[#A8A29E] font-mono mt-0.5">
            Merchant Guard: {formState.merchantProtectionGuard ? "Protected" : "Disabled"}
          </div>
        </div>
      </div>

      {/* Modern Segmented Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-[#F3EDE2] border border-[#E8E2D5] rounded-xl font-mono text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("traversal")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            activeTab === "traversal"
              ? "bg-white text-[#1C1917] shadow-xs"
              : "text-[#78716C] hover:text-[#1C1917]"
          }`}
        >
          <Filter className="w-3.5 h-3.5 text-[#D96B27]" />
          <span>[1] Investigation & Traversal Bounds</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("custom")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            activeTab === "custom"
              ? "bg-white text-[#1C1917] shadow-xs"
              : "text-[#78716C] hover:text-[#1C1917]"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#D96B27]" />
          <span>[2] Custom Parameter Rules</span>
          <span className="text-[10px] bg-[#D96B27] text-white px-1.5 py-0.2 rounded font-mono">
            {formState.customRules?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("heuristics")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            activeTab === "heuristics"
              ? "bg-white text-[#1C1917] shadow-xs"
              : "text-[#78716C] hover:text-[#1C1917]"
          }`}
        >
          <Cpu className="w-3.5 h-3.5 text-[#D96B27]" />
          <span>[3] PRD Heuristics Engine (P1–P10)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("simulation");
            runLiveSimulation(formState);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            activeTab === "simulation"
              ? "bg-white text-[#1C1917] shadow-xs"
              : "text-[#78716C] hover:text-[#1C1917]"
          }`}
        >
          <Terminal className="w-3.5 h-3.5 text-[#D96B27]" />
          <span>[4] Live Query Simulation & Impact</span>
          {simulating && <span className="animate-spin text-xs">⟳</span>}
        </button>
      </div>

      {/* TAB CONTENT 1: Core Traversal & Bounds */}
      {activeTab === "traversal" && (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="border-b border-[#F0EBE1] pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#1C1917] font-mono uppercase tracking-wider">
                Multi-Hop Graph Traversal Constraints
              </h2>
              <p className="text-xs text-[#78716C]">
                Controls the depth, velocity cutoff, and threshold criteria during Breadth-First Search (BFS) money trail construction.
              </p>
            </div>
            <span className="text-[10px] font-mono text-[#D96B27] bg-[#FAF6EE] px-2.5 py-1 rounded border border-[#E8E2D5]">
              Real-Time Vectorized Traversal
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Min Transaction Amount Filter */}
            <div className="space-y-2 lg:col-span-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[#1C1917]">MINIMUM TRANSACTION AMOUNT FILTER (INR)</span>
                <span className="font-bold text-[#D96B27]">{formatRupee(formState.minAmount)}</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs font-mono text-[#A8A29E]">₹</span>
                <input
                  type="number"
                  min="0"
                  step="5000"
                  value={formState.minAmount}
                  onChange={(e) => setFormState({ ...formState, minAmount: Number(e.target.value) || 0 })}
                  placeholder="0 (Include all transactions)"
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl pl-7 pr-3 py-2 text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
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
                        : "bg-[#FAF6EE] text-[#78716C] border-[#E8E2D5] hover:bg-[#F3EDE2]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Hop Depth */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[#1C1917]">MAX GRAPH TRAVERSAL DEPTH</span>
                <span className="font-bold text-[#D96B27]">{formState.maxHops} Hops</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((hop) => (
                  <button
                    key={hop}
                    type="button"
                    onClick={() => setFormState({ ...formState, maxHops: hop })}
                    className={`py-2 text-xs font-mono rounded-xl border text-center font-bold transition-all cursor-pointer ${
                      Number(formState.maxHops) === hop
                        ? "bg-[#1C1917] text-white border-[#1C1917]"
                        : "bg-[#FAF6EE] text-[#78716C] border-[#E8E2D5] hover:bg-[#F3EDE2]"
                    }`}
                  >
                    {hop}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#A8A29E] font-mono">
                L1 (Collector) → L2 (Distributors) → L3 (Cash-outs)
              </p>
            </div>

            {/* Velocity Dispersion Window */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[#1C1917]">VELOCITY DISPERSION WINDOW</span>
                <span className="font-bold text-[#D96B27]">{formState.timeWindow} Mins</span>
              </div>
              <select
                value={formState.timeWindow}
                onChange={(e) => setFormState({ ...formState, timeWindow: Number(e.target.value) })}
                className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
              >
                <option value={15}>15 Mins (Rapid Automated Burst)</option>
                <option value={30}>30 Mins (High-Speed Slicing)</option>
                <option value={60}>60 Mins (Standard Tactical Scan)</option>
                <option value={180}>180 Mins (3h Standard Investigation)</option>
                <option value={720}>720 Mins (12h Multi-Shift Window)</option>
                <option value={1440}>1440 Mins (24h Full Day Cycle)</option>
              </select>
            </div>

            {/* Bank / IFSC Routing */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[#1C1917]">BANK / IFSC ROUTING</span>
                <span className="font-bold text-[#D96B27]">{formState.bankFilter}</span>
              </div>
              <select
                value={formState.bankFilter}
                onChange={(e) => setFormState({ ...formState, bankFilter: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
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

            {/* Minimum Mule Risk Index */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[#1C1917]">MIN MULE RISK INDEX</span>
                <span className="font-bold text-[#D96B27]">{formState.minRisk}+ / 100</span>
              </div>
              <select
                value={formState.minRisk}
                onChange={(e) => setFormState({ ...formState, minRisk: Number(e.target.value) })}
                className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
              >
                <option value={0}>0+ (All Transacting Accounts)</option>
                <option value={35}>35+ (Suspected Mules & Up)</option>
                <option value={65}>65+ (High-Confidence Mules Only)</option>
                <option value={85}>85+ (Critical High-Risk Syndicate)</option>
                <option value={95}>95+ (Definite Terminal Cash-Out Nodes)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: Dynamic Custom Parameter Rules Builder */}
      {activeTab === "custom" && (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="border-b border-[#F0EBE1] pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#1C1917] font-mono uppercase tracking-wider">
                  Custom Forensic Parameter Rules Builder
                </h2>
                <span className="text-[10px] bg-[#ECFDF5] text-[#059669] px-2 py-0.5 rounded font-mono font-bold border border-[#A7F3D0]">
                  User Extensible
                </span>
              </div>
              <p className="text-xs text-[#78716C]">
                Add any number of custom parameter rules. These rules are compiled into DuckDB SQL clauses and evaluated during multi-hop graph tracing and fraud scanning.
              </p>
            </div>

            <button
              type="button"
              onClick={handleAddCustomRule}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-mono font-bold shadow-xs cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Parameter Rule</span>
            </button>
          </div>

          {/* Quick-Add Rule Templates */}
          <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-3 space-y-2">
            <div className="text-[10px] font-mono font-bold text-[#78716C] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D96B27]" />
              <span>1-Click Forensic Parameter Presets:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                {
                  label: "Crypto P2P Narration",
                  name: "Crypto P2P Narration",
                  field: "Narration",
                  operator: "contains",
                  value: "CRYPTO",
                  action: "FLAG_SUSPICIOUS"
                },
                {
                  label: "Digital Arrest Threat",
                  name: "Digital Arrest Narration",
                  field: "Narration",
                  operator: "contains",
                  value: "ARREST",
                  action: "AUTO_FREEZE"
                },
                {
                  label: "Micro-Smurfing Split (≤ ₹20K)",
                  name: "Micro-Smurfing Outflow",
                  field: "Amount_INR",
                  operator: "<=",
                  value: "20000",
                  action: "FLAG_SUSPICIOUS"
                },
                {
                  label: "Foreign Proxy IP (185.*)",
                  name: "Foreign Proxy Subnet 185",
                  field: "IP_Address",
                  operator: "starts_with",
                  value: "185.",
                  action: "AUTO_FREEZE"
                },
                {
                  label: "Headless Linux Script",
                  name: "Automated Linux Bot",
                  field: "Device_Type",
                  operator: "contains",
                  value: "Linux_Script",
                  action: "AUTO_FREEZE"
                },
                {
                  label: "Paytm Hop Siphon",
                  name: "Paytm Outflow Routing",
                  field: "Receiver_IFSC",
                  operator: "starts_with",
                  value: "PYTM",
                  action: "FILTER_MATCH"
                }
              ].map((tmpl) => (
                <button
                  key={tmpl.label}
                  type="button"
                  onClick={() => handleApplyPresetTemplate(tmpl)}
                  className="text-[10px] font-mono px-2 py-1 rounded-lg bg-white hover:bg-[#F3EDE2] text-[#1C1917] border border-[#E8E2D5] transition-all cursor-pointer"
                >
                  + {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Rules Table */}
          <div className="border border-[#E8E2D5] rounded-xl overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#F8F4EC] text-[#78716C] border-b border-[#E8E2D5]">
                <tr>
                  <th className="py-2.5 px-3 w-12 text-center">Status</th>
                  <th className="py-2.5 px-3">Rule Name</th>
                  <th className="py-2.5 px-3">Target Field</th>
                  <th className="py-2.5 px-3">Operator</th>
                  <th className="py-2.5 px-3">Match Value</th>
                  <th className="py-2.5 px-3">Forensic Action</th>
                  <th className="py-2.5 px-3 w-16 text-center">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EBE1] bg-white">
                {(formState.customRules || []).map((rule, idx) => (
                  <tr key={rule.id || idx} className={rule.enabled ? "bg-white" : "bg-[#FAF8F5] opacity-60"}>
                    {/* Status Toggle */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(idx)}
                        className="cursor-pointer"
                      >
                        {rule.enabled ? (
                          <div className="w-8 h-4 bg-[#10B981] rounded-full relative transition-all">
                            <span className="w-3 h-3 bg-white rounded-full absolute right-0.5 top-0.5" />
                          </div>
                        ) : (
                          <div className="w-8 h-4 bg-[#D6D3D1] rounded-full relative transition-all">
                            <span className="w-3 h-3 bg-white rounded-full absolute left-0.5 top-0.5" />
                          </div>
                        )}
                      </button>
                    </td>

                    {/* Rule Name */}
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={rule.name}
                        onChange={(e) => handleUpdateRule(idx, "name", e.target.value)}
                        placeholder="Rule Identifier"
                        className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs font-semibold text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
                      />
                    </td>

                    {/* Target Field */}
                    <td className="py-2 px-3">
                      <select
                        value={rule.field}
                        onChange={(e) => handleUpdateRule(idx, "field", e.target.value)}
                        className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
                      >
                        <option value="Amount_INR">Amount_INR (Amount)</option>
                        <option value="Receiver_IFSC">Receiver_IFSC (Bank)</option>
                        <option value="Sender_IFSC">Sender_IFSC (Bank)</option>
                        <option value="Narration">Narration (Remarks)</option>
                        <option value="IP_Address">IP_Address (IP / Subnet)</option>
                        <option value="Device_Type">Device_Type (Emulator/Bot)</option>
                        <option value="Payment_Mode">Payment_Mode (UPI/IMPS)</option>
                      </select>
                    </td>

                    {/* Operator */}
                    <td className="py-2 px-3">
                      <select
                        value={rule.operator}
                        onChange={(e) => handleUpdateRule(idx, "operator", e.target.value)}
                        className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
                      >
                        {rule.field === "Amount_INR" ? (
                          <>
                            <option value=">">&gt; (Greater than)</option>
                            <option value=">=">&gt;= (Greater or equal)</option>
                            <option value="<">&lt; (Less than)</option>
                            <option value="<=">&lt;= (Less or equal)</option>
                            <option value="==">== (Exact match)</option>
                          </>
                        ) : (
                          <>
                            <option value="contains">contains (Sub-string)</option>
                            <option value="starts_with">starts_with (Prefix)</option>
                            <option value="equals">equals (Exact match)</option>
                          </>
                        )}
                      </select>
                    </td>

                    {/* Value */}
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(idx, "value", e.target.value)}
                        placeholder="e.g. CRYPTO or 50000"
                        className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs font-mono font-bold text-[#D96B27] focus:outline-none focus:border-[#D96B27]"
                      />
                    </td>

                    {/* Action */}
                    <td className="py-2 px-3">
                      <select
                        value={rule.action}
                        onChange={(e) => handleUpdateRule(idx, "action", e.target.value)}
                        className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-lg px-2 py-1 text-xs text-[#1C1917] focus:outline-none focus:border-[#D96B27]"
                      >
                        <option value="FILTER_MATCH">Filter Match Only</option>
                        <option value="FLAG_SUSPICIOUS">Flag Suspected Mule (+25 pts)</option>
                        <option value="AUTO_FREEZE">Priority Sec 91 Lien Freeze</option>
                      </select>
                    </td>

                    {/* Delete */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(idx)}
                        className="p-1 rounded-lg text-[#DC2626] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
                        title="Delete parameter rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}

                {(formState.customRules || []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-xs text-[#A8A29E]">
                      No custom rules added yet. Click <strong>"+ Add Parameter Rule"</strong> or select a 1-click template above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: PRD Heuristics Engine (P1 to P10) */}
      {activeTab === "heuristics" && (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="border-b border-[#F0EBE1] pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#1C1917] font-mono uppercase tracking-wider">
                PRD 0–100 Mule Risk Index Heuristic Matrix (P1–P10)
              </h2>
              <p className="text-xs text-[#78716C]">
                Adjust mathematical weights for pass-through velocity, fan-in centrality, and smurfing detection as documented in the core PRD.
              </p>
            </div>
            <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded border ${
              totalWeight === 100
                ? "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]"
                : "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]"
            }`}>
              Weight Sum: {totalWeight} / 100
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* P1 */}
            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P1: Pass-Through Velocity</span>
                <span className="text-[#D96B27] font-bold">{formState.p1Weight} pts</span>
              </div>
              <p className="text-[11px] text-[#78716C]">Forwarded ≥ 85% within 3–15 minutes.</p>
              <input
                type="range"
                min="0"
                max="50"
                value={formState.p1Weight}
                onChange={(e) => setFormState({ ...formState, p1Weight: Number(e.target.value) || 0 })}
                className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
              />
            </div>

            {/* P2 */}
            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P2: Fan-In Centrality</span>
                <span className="text-[#D96B27] font-bold">{formState.p2Weight} pts</span>
              </div>
              <p className="text-[11px] text-[#78716C]">Burst of distinct victim senders into account.</p>
              <input
                type="range"
                min="0"
                max="40"
                value={formState.p2Weight}
                onChange={(e) => setFormState({ ...formState, p2Weight: Number(e.target.value) || 0 })}
                className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
              />
            </div>

            {/* P3 */}
            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P3: Fan-Out Smurfing Split</span>
                <span className="text-[#D96B27] font-bold">{formState.p3Weight} pts</span>
              </div>
              <p className="text-[11px] text-[#78716C]">Rapid slicing into 3–50 downstream accounts.</p>
              <input
                type="range"
                min="0"
                max="40"
                value={formState.p3Weight}
                onChange={(e) => setFormState({ ...formState, p3Weight: Number(e.target.value) || 0 })}
                className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
              />
            </div>

            {/* P4 */}
            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P4: Cash-Out & Anomaly Markers</span>
                <span className="text-[#D96B27] font-bold">{formState.p4Weight} pts</span>
              </div>
              <p className="text-[11px] text-[#78716C]">Foreign proxy IPs (185/194), headless bots, crypto P2P.</p>
              <input
                type="range"
                min="0"
                max="40"
                value={formState.p4Weight}
                onChange={(e) => setFormState({ ...formState, p4Weight: Number(e.target.value) || 0 })}
                className="w-full accent-[#D96B27] h-1.5 bg-[#E8E2D5] rounded-lg cursor-pointer"
              />
            </div>

            {/* P5 & P6 */}
            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P5: Shared Cluster Anomaly</span>
                <span className="text-[#D96B27] font-bold">{formState.p5Weight} pts</span>
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

            <div className="p-3.5 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-[#1C1917]">P6: Dormancy Awakening</span>
                <span className="text-[#D96B27] font-bold">{formState.p6Weight} pts</span>
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

          {/* Two-Signal Merchant Protection Guard */}
          <div className="p-4 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#059669]" />
                <span className="text-xs font-mono font-bold text-[#1C1917]">
                  Two-Signal False-Positive Merchant Guard (PRD Phase 2)
                </span>
              </div>
              <p className="text-[11px] text-[#78716C] mt-0.5">
                Suppresses false-positive freezing requisitions on legitimate high-volume merchants with zero cash-out anomalies and zero rapid outbound dissipation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormState({ ...formState, merchantProtectionGuard: !formState.merchantProtectionGuard })}
              className="cursor-pointer shrink-0"
            >
              {formState.merchantProtectionGuard ? (
                <div className="w-10 h-5 bg-[#10B981] rounded-full relative transition-all">
                  <span className="w-4 h-4 bg-white rounded-full absolute right-0.5 top-0.5" />
                </div>
              ) : (
                <div className="w-10 h-5 bg-[#D6D3D1] rounded-full relative transition-all">
                  <span className="w-4 h-4 bg-white rounded-full absolute left-0.5 top-0.5" />
                </div>
              )}
            </button>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: Live Query Simulation & Impact Tester */}
      {activeTab === "simulation" && (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-5">
          <div className="border-b border-[#F0EBE1] pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#1C1917] font-mono uppercase tracking-wider">
                Live Query Simulation & DuckDB Execution Engine
              </h2>
              <p className="text-xs text-[#78716C]">
                Inspect the dynamically compiled SQL WHERE clause and preview real matching transactions from DuckDB.
              </p>
            </div>
            <button
              type="button"
              onClick={() => runLiveSimulation(formState)}
              disabled={simulating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1C1917] text-white text-xs font-mono hover:bg-[#2E2824] transition-all cursor-pointer"
            >
              <span>{simulating ? "Evaluating..." : "Re-Run Query Simulation"}</span>
            </button>
          </div>

          {/* Compiled SQL Query Display */}
          <div className="bg-[#1C1917] text-[#10B981] rounded-xl p-3.5 font-mono text-xs space-y-1.5 overflow-x-auto border border-[#2E2824]">
            <div className="flex items-center justify-between text-[#A8A29E] text-[10px]">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#D96B27]" />
                COMPILED DUCKDB SQL FILTER CLAUSE
              </span>
              <span>Latency: {simulationData ? `${simulationData.latency_ms} ms` : "..."}</span>
            </div>
            <code className="text-white text-[11px] block">
              SELECT * FROM transactions WHERE{" "}
              <span className="text-[#34D399]">
                {simulationData ? simulationData.generated_where_clause : "1=1"}
              </span>
            </code>
          </div>

          {/* Preview of Sample Matches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-[#1C1917]">
                SAMPLE MATCHING TRANSACTIONS ({simulationData?.sample_txns?.length || 0} shown)
              </span>
              <span className="text-[#78716C]">
                Total Matches: {simulationData ? simulationData.total_matching_txns : 0}
              </span>
            </div>

            <div className="border border-[#E8E2D5] rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#F8F4EC] text-[#78716C] border-b border-[#E8E2D5]">
                  <tr>
                    <th className="py-2 px-3">Txn ID</th>
                    <th className="py-2 px-3">Sender Account</th>
                    <th className="py-2 px-3">Receiver Account</th>
                    <th className="py-2 px-3 text-right">Amount (INR)</th>
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Narration</th>
                    <th className="py-2 px-3">Device / IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EBE1] bg-white">
                  {simulationData?.sample_txns?.map((txn) => (
                    <tr key={txn.txn_id} className="hover:bg-[#FAF8F5]">
                      <td className="py-2 px-3 font-bold text-[#1C1917]">{txn.txn_id}</td>
                      <td className="py-2 px-3 text-[#78716C]">{txn.sender}</td>
                      <td className="py-2 px-3 font-semibold text-[#D96B27]">{txn.receiver}</td>
                      <td className="py-2 px-3 text-right font-bold text-[#1C1917]">
                        ₹{Number(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-3 text-[#78716C] text-[11px]">{txn.timestamp}</td>
                      <td className="py-2 px-3 text-[11px] text-[#A8A29E] max-w-[200px] truncate" title={txn.narration}>
                        {txn.narration}
                      </td>
                      <td className="py-2 px-3 text-[10px] text-[#78716C]">
                        {txn.device} <span className="text-[#A8A29E]">({txn.ip})</span>
                      </td>
                    </tr>
                  ))}

                  {(!simulationData?.sample_txns || simulationData.sample_txns.length === 0) && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-xs text-[#A8A29E]">
                        No transactions match the specified parameters. Try relaxing your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
