import React, { useState, useEffect, useMemo } from "react";
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Check,
  ShieldCheck,
  Zap,
  RotateCcw,
  Sparkles,
  Building,
  Clock,
  Coins,
  CheckCircle2,
  Layers,
  ArrowRight,
  Filter
} from "lucide-react";

export default function ForensicParametersView({
  forensicParams = {},
  onSaveParams,
  activeCase = "100000000001",
  onNavigateTab
}) {
  // PRD Baseline Defaults
  const defaultParams = {
    // Investigation Boundary Filters
    minAmount: 0,
    maxHops: 4,
    timeWindow: 180,
    bankFilter: "ALL",
    minRisk: 0,

    // Core Heuristic Weights (P1 to P6)
    p1Weight: 30,
    p2Weight: 15,
    p3Weight: 15,
    p4Weight: 25,
    p5Weight: 10,
    p6Weight: 5,

    // Active status for core parameters
    p1Enabled: true,
    p2Enabled: true,
    p3Enabled: true,
    p4Enabled: true,
    p5Enabled: true,
    p6Enabled: true,

    // Custom Forensic Parameters (User-Extensible P7, P8, P9...)
    customRules: [
      {
        id: "rule_crypto_p2p",
        name: "P7: Crypto P2P Narration",
        field: "Narration",
        operator: "contains",
        value: "CRYPTO",
        points: 25,
        action: "FLAG_SUSPICIOUS",
        enabled: true
      },
      {
        id: "rule_foreign_proxy",
        name: "P8: Foreign Proxy Subnet 194.x",
        field: "IP_Address",
        operator: "starts_with",
        value: "194.",
        points: 20,
        action: "AUTO_FREEZE",
        enabled: true
      }
    ]
  };

  const [formState, setFormState] = useState(() => ({
    ...defaultParams,
    ...(forensicParams || {}),
    customRules: forensicParams?.customRules || defaultParams.customRules
  }));

  const [saveSuccess, setSaveSuccess] = useState(false);

  // New Rule Form State
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleField, setNewRuleField] = useState("Narration");
  const [newRuleOperator, setNewRuleOperator] = useState("contains");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRulePoints, setNewRulePoints] = useState(20);
  const [newRuleAction, setNewRuleAction] = useState("FLAG_SUSPICIOUS");

  useEffect(() => {
    if (forensicParams && Object.keys(forensicParams).length > 0) {
      setFormState((prev) => ({
        ...prev,
        ...forensicParams,
        customRules: forensicParams.customRules || prev.customRules || defaultParams.customRules
      }));
    }
  }, [forensicParams]);

  // Total Active Parameters Count
  const activeParamsCount = useMemo(() => {
    let count = 0;
    if (formState.p1Enabled) count++;
    if (formState.p2Enabled) count++;
    if (formState.p3Enabled) count++;
    if (formState.p4Enabled) count++;
    if (formState.p5Enabled) count++;
    if (formState.p6Enabled) count++;
    const activeCustom = (formState.customRules || []).filter((r) => r.enabled).length;
    return count + activeCustom;
  }, [formState]);

  // Total Points Sum
  const totalPoints = useMemo(() => {
    let sum = 0;
    if (formState.p1Enabled) sum += Number(formState.p1Weight) || 0;
    if (formState.p2Enabled) sum += Number(formState.p2Weight) || 0;
    if (formState.p3Enabled) sum += Number(formState.p3Weight) || 0;
    if (formState.p4Enabled) sum += Number(formState.p4Weight) || 0;
    if (formState.p5Enabled) sum += Number(formState.p5Weight) || 0;
    if (formState.p6Enabled) sum += Number(formState.p6Weight) || 0;
    (formState.customRules || []).forEach((r) => {
      if (r.enabled) sum += Number(r.points) || 0;
    });
    return sum;
  }, [formState]);

  // Save changes
  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (onSaveParams) {
      onSaveParams(formState);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3500);
  };

  // Reset to Defaults
  const handleReset = () => {
    setFormState(defaultParams);
    if (onSaveParams) {
      onSaveParams(defaultParams);
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3500);
  };

  // Add Custom Parameter Manually
  const handleAddManualParameter = (e) => {
    e.preventDefault();
    if (!newRuleValue.trim()) {
      alert("Please enter a Target Value for the parameter.");
      return;
    }

    const nextIndex = (formState.customRules?.length || 0) + 7;
    const name = newRuleName.trim() || `P${nextIndex}: ${newRuleField} ${newRuleOperator} "${newRuleValue}"`;

    const newParam = {
      id: `param_${Date.now()}`,
      name,
      field: newRuleField,
      operator: newRuleOperator,
      value: newRuleValue.trim(),
      points: Number(newRulePoints) || 15,
      action: newRuleAction,
      enabled: true
    };

    const updatedRules = [...(formState.customRules || []), newParam];
    const updatedState = { ...formState, customRules: updatedRules };
    setFormState(updatedState);

    // Reset Form
    setNewRuleName("");
    setNewRuleValue("");
    setNewRulePoints(20);

    // Auto-save
    if (onSaveParams) onSaveParams(updatedState);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Delete Custom Rule
  const handleDeleteCustomRule = (index) => {
    const updated = (formState.customRules || []).filter((_, i) => i !== index);
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
  };

  // Toggle Custom Rule
  const handleToggleCustomRule = (index) => {
    const updated = [...(formState.customRules || [])];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
  };

  // 1-Click Quick Add Presets
  const quickPresets = [
    {
      label: "+ Digital Arrest Threat",
      name: "Digital Arrest Modus Operandi",
      field: "Narration",
      operator: "contains",
      value: "ARREST",
      points: 30,
      action: "FLAG_SUSPICIOUS"
    },
    {
      label: "+ Telegram Task Scam",
      name: "Telegram Task Scam Narration",
      field: "Narration",
      operator: "contains",
      value: "TASK",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      label: "+ Heavy Whale > ₹50L",
      name: "High Value Outlier > ₹50L",
      field: "Amount_INR",
      operator: ">",
      value: "5000000",
      points: 20,
      action: "AUTO_FREEZE"
    },
    {
      label: "+ Midnight Drain (12AM–4AM)",
      name: "Midnight Dormancy Burst",
      field: "Narration",
      operator: "contains",
      value: "IMPS",
      points: 15,
      action: "FLAG_SUSPICIOUS"
    },
    {
      label: "+ Headless Bot Script",
      name: "Headless Automated Bot",
      field: "Device_Type",
      operator: "contains",
      value: "Linux_Script",
      points: 20,
      action: "AUTO_FREEZE"
    },
    {
      label: "+ High-Risk Foreign IP 185.x",
      name: "Foreign Proxy IP 185.x",
      field: "IP_Address",
      operator: "starts_with",
      value: "185.",
      points: 25,
      action: "AUTO_FREEZE"
    }
  ];

  const handleApplyPreset = (preset) => {
    const nextIndex = (formState.customRules?.length || 0) + 7;
    const newParam = {
      id: `param_${Date.now()}`,
      name: `P${nextIndex}: ${preset.name}`,
      field: preset.field,
      operator: preset.operator,
      value: preset.value,
      points: preset.points,
      action: preset.action,
      enabled: true
    };
    const updated = {
      ...formState,
      customRules: [...(formState.customRules || []), newParam]
    };
    setFormState(updated);
    if (onSaveParams) onSaveParams(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="space-y-5">
      {/* 1. Header Bar with Overview & Actions */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 sm:p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#D96B27]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                Heuristics & Rule Customization Studio
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-[#2C2623] mt-0.5">
              Forensic Parameters Manager
            </h1>
            <p className="text-xs text-[#746D65] mt-1">
              Easily configure, weight, and manually add new forensic parameters ($P_1$ to $P_{20}+$). All parameters evaluate live across 2,000,000 transactions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Parameter Stats */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FAF6EE] border border-[#E8E2D5] rounded-sm text-xs font-mono">
              <span className="text-[#746D65]">Active Parameters:</span>
              <strong className="text-[#D96B27] font-bold">{activeParamsCount}</strong>
              <span className="text-[#D4CEBF]">|</span>
              <span className="text-[#746D65]">Total Weight:</span>
              <strong className="text-[#059669] font-bold">{totalPoints} pts</strong>
            </div>

            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] transition-all cursor-pointer shadow-2xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save & Apply Parameters</span>
            </button>
          </div>
        </div>

        {/* Save Confirmation Notification */}
        {saveSuccess && (
          <div className="mt-3 p-2.5 bg-[#D1FAE5] border border-[#6EE7B7] rounded-sm text-xs text-[#065F46] flex items-center gap-2 font-medium animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-[#059669]" />
            <span>Parameters saved successfully! All graph traces, dossier risk scores, and 60s scanner alerts updated.</span>
          </div>
        )}
      </div>

      {/* 2. 1-Click Fast Presets Strip */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-3.5 shadow-2xs space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#2C2623] font-mono">
            <Sparkles className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>1-CLICK QUICK ADD PRESETS:</span>
          </div>
          <span className="text-[11px] text-[#9E968D]">Click any preset to instantly add as a new parameter ($P_7, P_8, P_9\dots$)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickPresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleApplyPreset(preset)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#D4CEBF] hover:border-[#D96B27] text-xs font-mono font-semibold text-[#2C2623] transition-all cursor-pointer shadow-2xs"
            >
              <Plus className="w-3 h-3 text-[#D96B27]" />
              <span>{preset.label}</span>
              <span className="text-[10px] text-[#059669] font-bold">+{preset.points} pts</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Manually Add New Parameter Box (Simple, Intuitive Form) */}
      <div className="bg-white border border-[#D96B27]/40 rounded-md p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#F0EAE1] pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm bg-[#FAF6EE] border border-[#D96B27] flex items-center justify-center text-[#D96B27]">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-serif font-bold text-[#2C2623]">
                Add New Forensic Parameter Manually
              </h2>
              <p className="text-[11px] text-[#746D65]">
                Define a custom condition on any dataset column. Evaluated in real-time in DuckDB.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-xs bg-[#E6F7F0] text-[#059669]">
            Instant SQL Compilation
          </span>
        </div>

        <form onSubmit={handleAddManualParameter} className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. Parameter Name */}
            <div className="lg:col-span-2">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Parameter Name / Description
              </label>
              <input
                type="text"
                placeholder='e.g. "Crypto P2P Exit", "Rapid RTGS Midnight Drain"'
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none transition-colors"
              />
            </div>

            {/* 2. Target Column */}
            <div>
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Dataset Field
              </label>
              <select
                value={newRuleField}
                onChange={(e) => setNewRuleField(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none transition-colors"
              >
                <option value="Narration">Narration (Remarks)</option>
                <option value="Amount_INR">Amount_INR (Amount)</option>
                <option value="IP_Address">IP_Address (IP / VPN)</option>
                <option value="Device_Type">Device_Type (Bot / OS)</option>
                <option value="Receiver_IFSC">Receiver_IFSC (Bank)</option>
                <option value="Sender_IFSC">Sender_IFSC (Bank)</option>
                <option value="Payment_Mode">Payment_Mode (UPI/IMPS)</option>
              </select>
            </div>

            {/* 3. Operator */}
            <div>
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Condition
              </label>
              <select
                value={newRuleOperator}
                onChange={(e) => setNewRuleOperator(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none transition-colors"
              >
                {newRuleField === "Amount_INR" ? (
                  <>
                    <option value=">">&gt; (Greater than)</option>
                    <option value=">=">&gt;= (Greater or equal)</option>
                    <option value="<">&lt; (Less than)</option>
                    <option value="==">== (Exact amount)</option>
                  </>
                ) : (
                  <>
                    <option value="contains">contains (Sub-string)</option>
                    <option value="starts_with">starts_with (Prefix)</option>
                    <option value="equals">equals (Exact match)</option>
                  </>
                )}
              </select>
            </div>

            {/* 4. Target Value */}
            <div>
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Target Value
              </label>
              <input
                type="text"
                placeholder={newRuleField === "Amount_INR" ? "e.g. 5000000" : 'e.g. "CRYPTO" or "194."'}
                value={newRuleValue}
                onChange={(e) => setNewRuleValue(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 text-xs font-mono font-bold text-[#D96B27] focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-4">
              {/* Risk Points Slider/Input */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#2C2623]">Risk Points Added:</span>
                <select
                  value={newRulePoints}
                  onChange={(e) => setNewRulePoints(Number(e.target.value))}
                  className="h-8 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2 text-xs font-mono font-bold text-[#D96B27] focus:outline-none"
                >
                  <option value={5}>+5 pts (Minor anomaly)</option>
                  <option value={10}>+10 pts (Suspicious pattern)</option>
                  <option value={15}>+15 pts (Strong indicator)</option>
                  <option value={20}>+20 pts (High risk anomaly)</option>
                  <option value={25}>+25 pts (Critical syndicate marker)</option>
                  <option value={30}>+30 pts (Definite fraud marker)</option>
                </select>
              </div>

              {/* Action */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#2C2623]">Investigative Action:</span>
                <select
                  value={newRuleAction}
                  onChange={(e) => setNewRuleAction(e.target.value)}
                  className="h-8 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2 text-xs font-semibold text-[#2C2623] focus:outline-none"
                >
                  <option value="FLAG_SUSPICIOUS">Flag Suspected Mule (+Risk)</option>
                  <option value="AUTO_FREEZE">Priority Sec 91 Freeze Lien</option>
                  <option value="FILTER_MATCH">Filter Graph Trail Only</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Parameter to Engine</span>
            </button>
          </div>
        </form>
      </div>

      {/* 4. Complete Active Forensic Parameters List (P1 to P6 + Custom P7, P8, P9...) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="p-3.5 sm:p-4 bg-[#FAF6EE] border-b border-[#E8E2D5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#D96B27]" />
            <h2 className="text-sm font-serif font-bold text-[#2C2623]">
              Active Forensic Parameters & Heuristic Matrix
            </h2>
          </div>
          <span className="text-[11px] font-mono font-bold text-[#746D65]">
            Adjust weight points or toggle rules on/off in real-time
          </span>
        </div>

        <div className="divide-y divide-[#EFEAE1]">
          {/* Core P1 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P1
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Pass-Through Velocity (3–15m Drain)</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Detects $\ge 85\%$ of incoming funds drained to downstream accounts within 15 minutes.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p1Weight}
                  onChange={(e) => setFormState({ ...formState, p1Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p1Enabled: !formState.p1Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p1Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p1Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Core P2 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P2
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Fan-In Centrality (L1 Intake Convergence)</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Detects $\ge 5$ distinct victim senders converging into a single account in short bursts.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p2Weight}
                  onChange={(e) => setFormState({ ...formState, p2Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p2Enabled: !formState.p2Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p2Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p2Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Core P3 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P3
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Fan-Out Smurfing Split (L2 Layering)</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Slices incoming funds and disperses them across 3 to 50 downstream mules ($\ge 70\%$ outflow).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p3Weight}
                  onChange={(e) => setFormState({ ...formState, p3Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p3Enabled: !formState.p3Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p3Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p3Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Core P4 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P4
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Digital Footprint & Proxy Anomalies</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Foreign VPN/Proxy IPs (185/194 CIDR), headless script devices, and scam narrations.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p4Weight}
                  onChange={(e) => setFormState({ ...formState, p4Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p4Enabled: !formState.p4Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p4Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p4Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Core P5 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P5
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Shared Infrastructure Cluster</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Detects shared device fingerprints or proxy subnets clustered across multiple mule accounts.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p5Weight}
                  onChange={(e) => setFormState({ ...formState, p5Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p5Enabled: !formState.p5Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p5Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p5Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Core P6 Parameter */}
          <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/50 transition-colors">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                P6
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#2C2623] font-serif">Behavioral Burst Hold Time</h3>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                </div>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  High-frequency burst outbound transactions immediately following receipt of stolen funds.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={formState.p6Weight}
                  onChange={(e) => setFormState({ ...formState, p6Weight: Number(e.target.value) || 0 })}
                  className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                />
                <span className="text-[11px] text-[#746D65] font-mono">pts</span>
              </div>
              <button
                type="button"
                onClick={() => setFormState({ ...formState, p6Enabled: !formState.p6Enabled })}
                className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                  formState.p6Enabled
                    ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                    : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                }`}
              >
                {formState.p6Enabled ? "ACTIVE" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* CUSTOM USER-ADDED PARAMETERS (P7, P8, P9... P20+) */}
          {(formState.customRules || []).map((rule, idx) => (
            <div
              key={rule.id || idx}
              className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 bg-[#FAF6EE]/30 hover:bg-[#FAF6EE] transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-sm bg-[#D96B27]/10 border border-[#D96B27] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                  P{idx + 7}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-[#2C2623] font-serif">{rule.name}</h3>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#E0E7FF] text-[#4338CA]">
                      CUSTOM RULE
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#FEF3C7] text-[#D97706]">
                      {rule.action}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#746D65] mt-1">
                    <span>Field: <strong className="text-[#2C2623]">{rule.field}</strong></span>
                    <span>•</span>
                    <span>Condition: <strong className="text-[#2C2623]">{rule.operator}</strong></span>
                    <span>•</span>
                    <span>Value: <strong className="text-[#D96B27]">"{rule.value}"</strong></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Points:</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={rule.points || 20}
                    onChange={(e) => {
                      const updated = [...(formState.customRules || [])];
                      updated[idx] = { ...updated[idx], points: Number(e.target.value) || 0 };
                      setFormState({ ...formState, customRules: updated });
                    }}
                    className="w-14 h-7 text-center bg-white border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleCustomRule(idx)}
                  className={`text-[10px] font-mono font-bold px-2 py-1 rounded-sm border cursor-pointer ${
                    rule.enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {rule.enabled ? "ACTIVE" : "DISABLED"}
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteCustomRule(idx)}
                  className="p-1 rounded-sm text-[#DC2626] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
                  title="Delete parameter"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Core Investigation Boundary Sliders (At the Bottom) */}
      <div className="bg-white border border-[#E8E2D5] rounded-md p-4 sm:p-5 shadow-2xs space-y-3">
        <h3 className="text-xs font-serif font-bold text-[#2C2623] uppercase tracking-wider font-mono">
          Investigation Boundary & Graph Traversal Limits
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          {/* Min Amount */}
          <div className="space-y-1.5">
            <span className="font-semibold text-[#746D65]">MIN TRANSACTION AMOUNT</span>
            <select
              value={formState.minAmount}
              onChange={(e) => setFormState({ ...formState, minAmount: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none"
            >
              <option value={0}>All Amounts (₹0+)</option>
              <option value={50000}>₹50,000+ (Smurfing Cutoff)</option>
              <option value={100000}>₹1 Lakh+ (Significant Loss)</option>
              <option value={5000000}>₹50 Lakh+ (Whales Only)</option>
              <option value={10000000}>₹1 Crore+ (Severe Outliers)</option>
            </select>
          </div>

          {/* Max Hops */}
          <div className="space-y-1.5">
            <span className="font-semibold text-[#746D65]">MAX HOP DEPTH</span>
            <select
              value={formState.maxHops}
              onChange={(e) => setFormState({ ...formState, maxHops: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none"
            >
              <option value={1}>1 Hop (Victim ➔ L1 Collector)</option>
              <option value={2}>2 Hops (Up to L2 Distributors)</option>
              <option value={3}>3 Hops (Up to L3 Cashouts)</option>
              <option value={4}>4 Hops (Full Syndicate Trail)</option>
              <option value={5}>5 Hops (Deep Exhaustive Network)</option>
            </select>
          </div>

          {/* Time Window */}
          <div className="space-y-1.5">
            <span className="font-semibold text-[#746D65]">VELOCITY WINDOW</span>
            <select
              value={formState.timeWindow}
              onChange={(e) => setFormState({ ...formState, timeWindow: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none"
            >
              <option value={15}>15 Minutes (Rapid Drain)</option>
              <option value={30}>30 Minutes (Fast Slicing)</option>
              <option value={60}>60 Minutes (1 Hour Standard)</option>
              <option value={180}>180 Minutes (3 Hour Investigation)</option>
              <option value={1440}>1440 Minutes (24 Hour Full Cycle)</option>
            </select>
          </div>

          {/* Bank Route */}
          <div className="space-y-1.5">
            <span className="font-semibold text-[#746D65]">BANK / IFSC PREFIX</span>
            <select
              value={formState.bankFilter}
              onChange={(e) => setFormState({ ...formState, bankFilter: e.target.value })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none"
            >
              <option value="ALL">All Banks</option>
              <option value="SBIN">State Bank of India (SBIN)</option>
              <option value="HDFC">HDFC Bank (HDFC)</option>
              <option value="ICIC">ICICI Bank (ICIC)</option>
              <option value="UTIB">Axis Bank (UTIB)</option>
              <option value="PUNB">Punjab National Bank (PUNB)</option>
              <option value="UBIN">Union Bank of India (UBIN)</option>
              <option value="BARB">Bank of Baroda (BARB)</option>
              <option value="KKBK">Kotak Mahindra Bank (KKBK)</option>
              <option value="PYTM">Paytm Payments Bank (PYTM)</option>
              <option value="IPOS">India Post Payments Bank (IPOS)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
