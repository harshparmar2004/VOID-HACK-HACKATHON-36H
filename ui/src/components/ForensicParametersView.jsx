import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Check,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Layers,
  Settings2,
  Pencil,
  Copy,
  X,
  ArrowRight,
  Filter,
  CheckCheck
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
    p1Weight: 30, // Pass-through velocity
    p2Weight: 15, // Fan-in centrality
    p3Weight: 15, // Fan-out smurfing split
    p4Weight: 20, // ATM/Crypto Cash-out
    p5Weight: 10, // Geolocation / IP Anomaly
    p6Weight: 5,  // Burst Hold Time

    // Core Toggles
    p1Enabled: true,
    p2Enabled: true,
    p3Enabled: true,
    p4Enabled: true,
    p5Enabled: true,
    p6Enabled: true,

    // Dynamic Custom Rules (P7, P8, P9... P20+)
    customRules: []
  };

  const [formState, setFormState] = useState(() => ({
    ...defaultParams,
    ...(forensicParams || {}),
    customRules: forensicParams?.customRules || defaultParams.customRules
  }));

  const [filterCategory, setFilterCategory] = useState("ALL"); // 'ALL' | 'CORE' | 'CUSTOM'
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Builder Form State (Add / Update)
  const [editingRuleId, setEditingRuleId] = useState(null); // null when adding, string when editing
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleField, setNewRuleField] = useState("Narration");
  const [newRuleOperator, setNewRuleOperator] = useState("contains");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRulePoints, setNewRulePoints] = useState(20);
  const [newRuleAction, setNewRuleAction] = useState("FLAG_SUSPICIOUS");

  // Preset Category Filter
  const [presetCategory, setPresetCategory] = useState("ALL"); // ALL | SCAMS | BOTS | IPS | AMOUNTS | CHANNELS

  const builderRef = useRef(null);

  useEffect(() => {
    if (forensicParams && Object.keys(forensicParams).length > 0) {
      setFormState((prev) => ({
        ...prev,
        ...forensicParams,
        customRules: forensicParams.customRules || prev.customRules || defaultParams.customRules
      }));
    }
  }, [forensicParams]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

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
    showToast("Parameters saved successfully! All graph traces, dossier risk scores, and 60s scanner alerts updated.");
    setTimeout(() => setSaveSuccess(false), 3500);
  };

  // Reset to Defaults
  const handleReset = () => {
    setFormState(defaultParams);
    setEditingRuleId(null);
    resetBuilderForm();
    if (onSaveParams) {
      onSaveParams(defaultParams);
    }
    setSaveSuccess(true);
    showToast("Reset all parameters and thresholds to PRD baseline defaults.");
    setTimeout(() => setSaveSuccess(false), 3500);
  };

  // Reset Builder Form
  const resetBuilderForm = () => {
    setEditingRuleId(null);
    setNewRuleName("");
    setNewRuleField("Narration");
    setNewRuleOperator("contains");
    setNewRuleValue("");
    setNewRulePoints(20);
    setNewRuleAction("FLAG_SUSPICIOUS");
  };

  // Submit Builder: Handles both ADD and UPDATE (Free Will to Edit)
  const handleSubmitBuilder = (e) => {
    e.preventDefault();
    if (!newRuleValue.trim()) {
      alert("Please enter a Target Value for the parameter.");
      return;
    }

    if (editingRuleId) {
      // UPDATE EXISTING PARAMETER
      const updatedRules = (formState.customRules || []).map((rule) => {
        if (rule.id === editingRuleId) {
          return {
            ...rule,
            name: newRuleName.trim() || rule.name,
            field: newRuleField,
            operator: newRuleOperator,
            value: newRuleValue.trim(),
            points: Number(newRulePoints) || 15,
            action: newRuleAction
          };
        }
        return rule;
      });

      const updatedState = { ...formState, customRules: updatedRules };
      setFormState(updatedState);
      if (onSaveParams) onSaveParams(updatedState);

      showToast(`Updated parameter "${newRuleName || 'Custom Rule'}" successfully.`);
      resetBuilderForm();
    } else {
      // ADD NEW PARAMETER
      const nextIndex = (formState.customRules?.length || 0) + 7;
      const name = newRuleName.trim() || `P${nextIndex}: ${newRuleField} ${newRuleOperator} "${newRuleValue}"`;

      const newParam = {
        id: `param_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
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
      if (onSaveParams) onSaveParams(updatedState);

      showToast(`Added parameter "${name}" to engine.`);
      resetBuilderForm();
    }
  };

  // Start Editing a Custom Rule (Loads into Builder)
  const handleStartEdit = (rule) => {
    setEditingRuleId(rule.id);
    setNewRuleName(rule.name);
    setNewRuleField(rule.field);
    setNewRuleOperator(rule.operator);
    setNewRuleValue(rule.value);
    setNewRulePoints(rule.points);
    setNewRuleAction(rule.action);

    // Scroll builder into view
    if (builderRef.current) {
      builderRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    showToast(`Loaded "${rule.name}" into builder. Update values below.`);
  };

  // Duplicate / Clone a Rule
  const handleDuplicateRule = (rule) => {
    const nextIndex = (formState.customRules?.length || 0) + 7;
    const cloned = {
      ...rule,
      id: `param_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: `${rule.name} (Copy)`,
      enabled: true
    };
    const updated = [...(formState.customRules || []), cloned];
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
    showToast(`Duplicated parameter as "${cloned.name}".`);
  };

  // Clone a Core Heuristic (P1 to P6) into a Custom Rule for user customization
  const handleCloneCoreToCustom = (code, title, desc, defaultPoints) => {
    const nextIndex = (formState.customRules?.length || 0) + 7;
    const cloned = {
      id: `param_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: `Custom ${code}: ${title}`,
      field: code === "P1" ? "Pass_Through_Velocity" : code === "P4" ? "Narration" : code === "P5" ? "IP_Address" : "Amount_INR",
      operator: "contains",
      value: code === "P4" ? "CRYPTO" : code === "P5" ? "185." : "> 85%",
      points: defaultPoints,
      action: "FLAG_SUSPICIOUS",
      enabled: true
    };
    const updated = [...(formState.customRules || []), cloned];
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
    showToast(`Cloned ${code} into Custom Rule P${nextIndex} for free editing.`);
  };

  // Delete Custom Rule
  const handleDeleteCustomRule = (index) => {
    const ruleToDelete = (formState.customRules || [])[index];
    if (ruleToDelete && ruleToDelete.id === editingRuleId) {
      resetBuilderForm();
    }
    const updated = (formState.customRules || []).filter((_, i) => i !== index);
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
    showToast("Deleted parameter from engine.");
  };

  // Toggle Custom Rule
  const handleToggleCustomRule = (index) => {
    const updated = [...(formState.customRules || [])];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
  };

  // Direct Inline Action Change for Custom Rule
  const handleInlineActionChange = (index, newAction) => {
    const updated = [...(formState.customRules || [])];
    updated[index] = { ...updated[index], action: newAction };
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
  };

  // Direct Inline Points Change for Custom Rule
  const handleInlinePointsChange = (index, points) => {
    const updated = [...(formState.customRules || [])];
    updated[index] = { ...updated[index], points: Math.max(0, Math.min(100, Number(points) || 0)) };
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
  };

  // 1-Click Load into Builder Preset (User can edit or apply instantly)
  const handleLoadPresetToBuilder = (preset) => {
    setEditingRuleId(null);
    setNewRuleName(preset.name);
    setNewRuleField(preset.field);
    setNewRuleOperator(preset.operator);
    setNewRuleValue(preset.value);
    setNewRulePoints(preset.points);
    setNewRuleAction(preset.action);

    if (builderRef.current) {
      builderRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    showToast(`Loaded preset "${preset.title}" into builder. Tweak or click Add below.`);
  };

  // 1-Click Direct Add Preset
  const handleDirectAddPreset = (preset) => {
    const nextIndex = (formState.customRules?.length || 0) + 7;
    const newParam = {
      id: `param_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: preset.name,
      field: preset.field,
      operator: preset.operator,
      value: preset.value,
      points: preset.points,
      action: preset.action,
      enabled: true
    };
    const updated = [...(formState.customRules || []), newParam];
    const updatedState = { ...formState, customRules: updated };
    setFormState(updatedState);
    if (onSaveParams) onSaveParams(updatedState);
    showToast(`Directly added preset "${preset.title}" (+${preset.points} pts).`);
  };

  // 25+ Comprehensive Presets Directly Derived from the 2,000,000 DuckDB Dataset
  const realDataPresets = [
    // 1. SCAMS & FRAUD NARRATIONS (from actual dataset occurrences)
    {
      cat: "SCAMS",
      title: "Digital Arrest Extortion",
      name: "Digital Arrest Modus Operandi (CBI/Police)",
      field: "Narration",
      operator: "contains",
      value: "ARREST",
      points: 35,
      action: "AUTO_FREEZE"
    },
    {
      cat: "SCAMS",
      title: "Supreme Court Escrow Scam",
      name: "Urgent Supreme Court Security Escrow",
      field: "Narration",
      operator: "contains",
      value: "SUPREME-COURT",
      points: 35,
      action: "AUTO_FREEZE"
    },
    {
      cat: "SCAMS",
      title: "CBI Security Escrow",
      name: "CBI National Security Escrow Transfer",
      field: "Narration",
      operator: "contains",
      value: "CBI",
      points: 35,
      action: "AUTO_FREEZE"
    },
    {
      cat: "SCAMS",
      title: "SEBI Fake IPO Block",
      name: "SEBI Institutional Block IPO Allotment",
      field: "Narration",
      operator: "contains",
      value: "IPO-ALLOTMENT",
      points: 30,
      action: "AUTO_FREEZE"
    },
    {
      cat: "SCAMS",
      title: "Mahadev Betting VIP",
      name: "Mahadev VIP Commission Settlement",
      field: "Narration",
      operator: "contains",
      value: "MAHADEV",
      points: 30,
      action: "AUTO_FREEZE"
    },
    {
      cat: "SCAMS",
      title: "P2P Binance USDT Exit",
      name: "Binance P2P Crypto Off-Ramp Drain",
      field: "Narration",
      operator: "contains",
      value: "BINANCE",
      points: 30,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "SCAMS",
      title: "Telegram Task Scam",
      name: "Telegram Daily Task Review Scam",
      field: "Narration",
      operator: "contains",
      value: "Telegram",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "SCAMS",
      title: "Task Bonus Ponzi Bait",
      name: "Task Bonus Refund Bait & Switch",
      field: "Narration",
      operator: "contains",
      value: "Task-Bonus",
      points: 20,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "SCAMS",
      title: "Shadow Payout Gateway",
      name: "Express Payout Shadow Payment Gateway",
      field: "Narration",
      operator: "contains",
      value: "Express-Payout",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "SCAMS",
      title: "Fast Settlement Hawala",
      name: "Fast Settlement Liquidity Pool",
      field: "Narration",
      operator: "contains",
      value: "Settlement-Pool",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "SCAMS",
      title: "P2P USDT Layering Settle",
      name: "P2P USDT Rapid OTC Settlement",
      field: "Narration",
      operator: "contains",
      value: "USDT",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },

    // 2. DEVICE & AUTOMATION BOTS (from actual Device_Type)
    {
      cat: "BOTS",
      title: "Linux Headless Script Bot",
      name: "Linux Python/Curl Automated Drain Bot",
      field: "Device_Type",
      operator: "equals",
      value: "Linux_Script",
      points: 25,
      action: "AUTO_FREEZE"
    },
    {
      cat: "BOTS",
      title: "Web Mobile Emulator (Nox)",
      name: "Android Virtualized Emulator / Nox",
      field: "Device_Type",
      operator: "equals",
      value: "Web_Emulator",
      points: 20,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "BOTS",
      title: "API Automation Script (curl)",
      name: "Automated API Request / Postman / curl",
      field: "Device_Type",
      operator: "contains",
      value: "curl",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },

    // 3. OFFSHORE & PROXY IP SUBNETS (from actual IP_Address)
    {
      cat: "IPS",
      title: "Bulletproof Offshore IP (185.x)",
      name: "Offshore Bulletproof Hosting (185.x Subnet)",
      field: "IP_Address",
      operator: "starts_with",
      value: "185.",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "IPS",
      title: "Tor / VPN Exit Proxy (194.x)",
      name: "Tor / VPN Anonymized Proxy (194.x Subnet)",
      field: "IP_Address",
      operator: "starts_with",
      value: "194.",
      points: 25,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "IPS",
      title: "Seychelles/HK Proxy (45.x)",
      name: "Foreign Proxy Gateway (45.x Subnet)",
      field: "IP_Address",
      operator: "starts_with",
      value: "45.",
      points: 20,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "IPS",
      title: "Offshore Layering IP (91.x)",
      name: "Foreign Evasion Host (91.x Subnet)",
      field: "IP_Address",
      operator: "starts_with",
      value: "91.",
      points: 20,
      action: "FLAG_SUSPICIOUS"
    },

    // 4. AMOUNTS & SLICING (from actual Amount distributions)
    {
      cat: "AMOUNTS",
      title: "Heavy Whale Outlier (> ₹50L)",
      name: "High Value Whale Anomaly > ₹50 Lakh",
      field: "Amount_INR",
      operator: ">",
      value: "5000000",
      points: 30,
      action: "AUTO_FREEZE"
    },
    {
      cat: "AMOUNTS",
      title: "Multi-Crore Syndicate Drain (> ₹1 Cr)",
      name: "Multi-Crore Catastrophic Siphon > ₹1 Crore",
      field: "Amount_INR",
      operator: ">",
      value: "10000000",
      points: 35,
      action: "AUTO_FREEZE"
    },
    {
      cat: "AMOUNTS",
      title: "Extortion Loss Median (> ₹2.5L)",
      name: "Digital Arrest Standard Extortion > ₹2.5 Lakh",
      field: "Amount_INR",
      operator: ">",
      value: "250000",
      points: 25,
      action: "AUTO_FREEZE"
    },
    {
      cat: "AMOUNTS",
      title: "Smurfing Micro-Split (< ₹50K)",
      name: "Rapid Slicing Smurfing Below ₹50K",
      field: "Amount_INR",
      operator: "<",
      value: "50000",
      points: 15,
      action: "FLAG_SUSPICIOUS"
    },

    // 5. CHANNELS & BANKS (from actual Payment_Mode & IFSC)
    {
      cat: "CHANNELS",
      title: "RTGS High-Value Corridor",
      name: "RTGS Syndicate High-Value Exit",
      field: "Payment_Mode",
      operator: "equals",
      value: "RTGS",
      points: 20,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "CHANNELS",
      title: "IMPS Automated Siphon Burst",
      name: "Instant IMPS Rapid Layering Burst",
      field: "Payment_Mode",
      operator: "equals",
      value: "IMPS",
      points: 15,
      action: "FLAG_SUSPICIOUS"
    },
    {
      cat: "CHANNELS",
      title: "State Bank Siphon Route (SBIN)",
      name: "Target State Bank Receiver Route",
      field: "Receiver_IFSC",
      operator: "starts_with",
      value: "SBIN",
      points: 10,
      action: "FILTER_MATCH"
    },
    {
      cat: "CHANNELS",
      title: "Punjab National Route (PUNB)",
      name: "Target Punjab National Receiver Route",
      field: "Receiver_IFSC",
      operator: "starts_with",
      value: "PUNB",
      points: 10,
      action: "FILTER_MATCH"
    },
    {
      cat: "CHANNELS",
      title: "Axis Bank Corridor (UTIB)",
      name: "Target Axis Bank Channel",
      field: "Receiver_IFSC",
      operator: "starts_with",
      value: "UTIB",
      points: 10,
      action: "FILTER_MATCH"
    }
  ];

  // Filtered Presets based on presetCategory
  const displayedPresets = useMemo(() => {
    if (presetCategory === "ALL") return realDataPresets;
    return realDataPresets.filter((p) => p.cat === presetCategory);
  }, [presetCategory]);

  return (
    <div className="space-y-5">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 p-3 bg-[#2C2623] text-white rounded-md shadow-lg border border-[#D96B27] flex items-center gap-2.5 text-xs font-mono animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#D96B27] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. TOP: Forensic Parameters Manager (Header & Actions)   */}
      {/* ======================================================== */}
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
              Real-time parameter engine running across 2,000,000 transactions. Freely edit weights, customize conditions, and apply fraud presets.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#2C2623] text-xs font-semibold hover:bg-[#FAF6EE] transition-all cursor-pointer shadow-2xs"
              title="Reset all parameters to baseline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
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

      {/* ======================================================== */}
      {/* 2. BELOW: Add / Edit Parameter (Full Width Left to Right) */}
      {/* ======================================================== */}
      <div
        ref={builderRef}
        className={`bg-white border rounded-md shadow-2xs overflow-hidden transition-all ${
          editingRuleId ? "border-[#D96B27] ring-1 ring-[#D96B27]/30" : "border-[#E8E2D5]"
        }`}
      >
        {/* Card Header */}
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-sm border flex items-center justify-center ${
              editingRuleId ? "bg-[#D96B27] text-white border-[#D96B27]" : "bg-white text-[#D96B27] border-[#D4CEBF]"
            }`}>
              {editingRuleId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-serif font-bold text-[#2C2623]">
                  {editingRuleId ? "Edit Forensic Parameter" : "Add Forensic Parameter"}
                </h2>
                {editingRuleId && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-xs bg-[#FEF3C7] text-[#B45309] border border-[#FCD34D]">
                    EDIT MODE ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-[#746D65]">
                {editingRuleId
                  ? "Modifying parameter condition and weights. Click 'Update Parameter' to save changes."
                  : "Manual condition builder and 1-click real dataset preset library (P7–P25+)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {editingRuleId && (
              <button
                type="button"
                onClick={resetBuilderForm}
                className="flex items-center gap-1 px-2.5 py-1 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#DC2626] text-xs font-mono cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel Edit</span>
              </button>
            )}
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-xs bg-[#E6F7F0] text-[#059669] border border-[#A7F3D0]">
              Real-Time DuckDB Compilation
            </span>
          </div>
        </div>

        {/* 1-Click Quick Presets Strip (Organized Rows & Columns Grid) */}
        <div className="p-4 bg-[#FDFBF7] border-b border-[#F0EAE1] space-y-3">
          {/* Header & Category Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1 border-b border-[#F0EAE1]">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#D96B27]">
              <Sparkles className="w-3.5 h-3.5 text-[#D96B27]" />
              <span className="tracking-wide">REAL DATASET FRAUD PRESETS ({displayedPresets.length}):</span>
            </div>

            {/* Category Filter Pills with proper spacing */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              {[
                { id: "ALL", label: `All (${realDataPresets.length})` },
                { id: "SCAMS", label: "Scam Narrations (11)" },
                { id: "BOTS", label: "Bots & Scripts (3)" },
                { id: "IPS", label: "Proxy / Tor IPs (4)" },
                { id: "AMOUNTS", label: "Whales & Amounts (4)" },
                { id: "CHANNELS", label: "Banks & Modes (5)" }
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPresetCategory(c.id)}
                  className={`px-2.5 py-1 rounded-sm text-xs transition-all cursor-pointer font-medium ${
                    presetCategory === c.id
                      ? "bg-[#D96B27] text-white font-bold shadow-2xs"
                      : "bg-white text-[#746D65] border border-[#E8E2D5] hover:border-[#D4CEBF] hover:text-[#2C2623]"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Organized Rows & Columns Grid (Equal widths, heights & spacing) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 max-h-72 overflow-y-auto pr-1">
            {displayedPresets.map((preset) => (
              <div
                key={preset.title}
                className="group bg-white hover:bg-[#FAF8F5] border border-[#E8E2D5] hover:border-[#D96B27] rounded-sm p-2.5 transition-all shadow-2xs hover:shadow-xs flex items-center justify-between gap-2 min-h-[58px]"
              >
                {/* Clickable Preset Body (Loads into Builder Form) */}
                <button
                  type="button"
                  onClick={() => handleLoadPresetToBuilder(preset)}
                  className="flex-1 min-w-0 text-left cursor-pointer focus:outline-none"
                  title="Click to load into form and edit freely before applying"
                >
                  <div className="flex items-center gap-1.5">
                    <Pencil className="w-2.5 h-2.5 text-[#9E968D] group-hover:text-[#D96B27] shrink-0" />
                    <span className="font-mono text-xs font-semibold text-[#2C2623] group-hover:text-[#D96B27] truncate block">
                      {preset.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-mono">
                    <span className="text-[#746D65] bg-[#FAF6EE] px-1.5 py-0.5 rounded-2xs border border-[#E8E2D5] truncate max-w-[120px]">
                      {preset.field}: {preset.value}
                    </span>
                    <span className="text-[#059669] bg-emerald-50 px-1.5 py-0.5 rounded-2xs border border-emerald-200 font-bold shrink-0">
                      +{preset.points} pts
                    </span>
                  </div>
                </button>

                {/* Direct 1-Click Add Action Button */}
                <button
                  type="button"
                  onClick={() => handleDirectAddPreset(preset)}
                  className="shrink-0 px-2.5 py-1.5 bg-[#FAF6EE] hover:bg-[#D96B27] text-[#D96B27] hover:text-white border border-[#E8E2D5] hover:border-[#D96B27] rounded-sm text-[11px] font-mono font-bold cursor-pointer transition-all shadow-2xs active:scale-95"
                  title="Direct 1-Click Add to active rules"
                >
                  + Add
                </button>
              </div>
            ))}
          </div>

          {/* Micro Information Footer */}
          <div className="text-[10px] text-[#746D65] font-mono flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#F0EAE1]">
            <span className="flex items-center gap-1">
              <span className="text-[#D96B27] font-bold">💡 Tip:</span> Click any card to customize in builder below, or click "+ Add" for instant application.
            </span>
            <span className="text-[#9E968D]">Dataset: DuckDB 2,000,008 Rows • Columnar Vector</span>
          </div>
        </div>


        {/* Manual Parameter Builder Form (Horizontal Grid) */}
        <form onSubmit={handleSubmitBuilder} className="p-4 sm:p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            {/* 1. Parameter Name */}
            <div className="lg:col-span-3">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Parameter Name / Description
              </label>
              <input
                type="text"
                placeholder='e.g. "Crypto P2P Exit", "RTGS Midnight Drain"'
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none transition-colors"
              />
            </div>

            {/* 2. Dataset Field */}
            <div className="lg:col-span-2">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Dataset Field
              </label>
              <select
                value={newRuleField}
                onChange={(e) => setNewRuleField(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none transition-colors cursor-pointer"
              >
                <option value="Narration">Narration (Remarks / MoP)</option>
                <option value="Amount_INR">Amount_INR (Amount / Value)</option>
                <option value="IP_Address">IP_Address (Subnet / Proxy)</option>
                <option value="Device_Type">Device_Type (Bot / OS / VM)</option>
                <option value="Payment_Mode">Payment_Mode (UPI/IMPS/RTGS)</option>
                <option value="Receiver_IFSC">Receiver_IFSC (Target Bank)</option>
                <option value="Sender_IFSC">Sender_IFSC (Source Bank)</option>
              </select>
            </div>

            {/* 3. Condition */}
            <div className="lg:col-span-2">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Condition
              </label>
              <select
                value={newRuleOperator}
                onChange={(e) => setNewRuleOperator(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2 text-xs font-mono font-semibold text-[#2C2623] focus:outline-none transition-colors cursor-pointer"
              >
                {newRuleField === "Amount_INR" ? (
                  <>
                    <option value=">">&gt; (Greater than)</option>
                    <option value=">=">&gt;= (Greater or equal)</option>
                    <option value="<">&lt; (Less than)</option>
                    <option value="<=">&lt;= (Less or equal)</option>
                    <option value="==">== (Exact amount)</option>
                  </>
                ) : (
                  <>
                    <option value="contains">contains (Sub-string match)</option>
                    <option value="starts_with">starts_with (Prefix match)</option>
                    <option value="equals">equals (Exact string match)</option>
                  </>
                )}
              </select>
            </div>

            {/* 4. Target Value */}
            <div className="lg:col-span-2">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Target Value
              </label>
              <input
                type="text"
                placeholder={
                  newRuleField === "Amount_INR"
                    ? "e.g. 5000000"
                    : newRuleField === "IP_Address"
                    ? "e.g. 185. or 194."
                    : newRuleField === "Device_Type"
                    ? "e.g. Linux_Script"
                    : 'e.g. "ARREST", "BINANCE"'
                }
                value={newRuleValue}
                onChange={(e) => setNewRuleValue(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2.5 text-xs font-mono text-[#2C2623] focus:outline-none transition-colors"
              />
            </div>

            {/* 5. Points Weight (Free Will Input) */}
            <div className="lg:col-span-1">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Points (+/-)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={newRulePoints}
                onChange={(e) => setNewRulePoints(Number(e.target.value) || 0)}
                className="w-full h-8.5 bg-[#FAF6EE] focus:bg-white border border-[#D4CEBF] focus:border-[#D96B27] rounded-sm px-2 text-xs font-mono font-bold text-[#D96B27] text-center focus:outline-none"
              />
            </div>

            {/* 6. Action */}
            <div className="lg:col-span-2">
              <label className="text-[11px] font-bold text-[#2C2623] block mb-1">
                Action
              </label>
              <select
                value={newRuleAction}
                onChange={(e) => setNewRuleAction(e.target.value)}
                className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2 text-xs font-semibold text-[#2C2623] focus:outline-none cursor-pointer"
              >
                <option value="FLAG_SUSPICIOUS">Flag Suspected Mule</option>
                <option value="AUTO_FREEZE">Priority Lien Freeze</option>
                <option value="FILTER_MATCH">Filter Trail Only</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#F0EAE1]">
            <div className="flex items-center gap-2 text-[11px] font-mono text-[#746D65]">
              <span>Quick Points:</span>
              {[10, 15, 20, 25, 30, 35, 50].map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setNewRulePoints(pt)}
                  className={`px-1.5 py-0.5 rounded-xs text-[10px] cursor-pointer transition-colors ${
                    Number(newRulePoints) === pt
                      ? "bg-[#D96B27] text-white font-bold"
                      : "bg-[#FAF6EE] hover:bg-[#EAE4D8] text-[#2C2623] border border-[#D4CEBF]"
                  }`}
                >
                  +{pt}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {editingRuleId && (
                <button
                  type="button"
                  onClick={resetBuilderForm}
                  className="px-4 py-2 rounded-sm bg-white hover:bg-[#FAF6EE] border border-[#D4CEBF] text-[#746D65] hover:text-[#2C2623] text-xs font-semibold transition-all cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 rounded-sm bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
              >
                {editingRuleId ? <CheckCheck className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{editingRuleId ? "Update Parameter (Save Changes)" : "Add Parameter to Engine"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ======================================================== */}
      {/* 3. BELOW THAT: Investigation Limits (Full Width 4 Cols)  */}
      {/* ======================================================== */}
      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[#D96B27]" />
            <h3 className="text-xs font-serif font-bold text-[#2C2623] uppercase tracking-wider font-mono">
              Investigation Limits & Boundary Constraints
            </h3>
          </div>
          <span className="text-[10px] font-mono text-[#746D65]">Multi-Hop Graph & Velocity Limits</span>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          {/* Min Amount */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#746D65] uppercase">Min Transaction Amount</span>
            <select
              value={formState.minAmount}
              onChange={(e) => setFormState({ ...formState, minAmount: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none cursor-pointer"
            >
              <option value={0}>All Amounts (₹0+)</option>
              <option value={50000}>₹50K+ (Smurfing Cutoff)</option>
              <option value={100000}>₹1 Lakh+ (Significant Loss)</option>
              <option value={250000}>₹2.5 Lakh+ (Digital Arrest Median)</option>
              <option value={5000000}>₹50 Lakh+ (Whales Only)</option>
              <option value={10000000}>₹1 Crore+ (Severe Outliers)</option>
            </select>
          </div>

          {/* Max Hop Depth */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#746D65] uppercase">Max Graph Traversal Depth</span>
            <select
              value={formState.maxHops}
              onChange={(e) => setFormState({ ...formState, maxHops: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none cursor-pointer"
            >
              <option value={1}>1 Hop (Victim ➔ L1 Collector)</option>
              <option value={2}>2 Hops (Up to L2 Distributors)</option>
              <option value={3}>3 Hops (Up to L3 Cashouts)</option>
              <option value={4}>4 Hops (Full Syndicate Trail)</option>
              <option value={5}>5 Hops (Deep Exhaustive Network)</option>
            </select>
          </div>

          {/* Velocity Window */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#746D65] uppercase">Velocity Dispersion Window</span>
            <select
              value={formState.timeWindow}
              onChange={(e) => setFormState({ ...formState, timeWindow: Number(e.target.value) })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none cursor-pointer"
            >
              <option value={15}>15 Minutes (Rapid Automated Drain)</option>
              <option value={30}>30 Minutes (Fast Slicing)</option>
              <option value={60}>60 Minutes (1 Hour Standard)</option>
              <option value={180}>180 Minutes (3 Hour Standard)</option>
              <option value={1440}>1440 Minutes (24 Hour Full Day)</option>
            </select>
          </div>

          {/* Bank Route */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-[#746D65] uppercase">Target Bank / IFSC Prefix</span>
            <select
              value={formState.bankFilter}
              onChange={(e) => setFormState({ ...formState, bankFilter: e.target.value })}
              className="w-full h-8.5 bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm px-2.5 text-xs text-[#2C2623] focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Banks (Multi-Bank Aggregation)</option>
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

      {/* ======================================================== */}
      {/* 4. BELOW THAT: Active Parameters & Heuristic Matrix       */}
      {/* ======================================================== */}
      <div className="bg-white border border-[#E8E2D5] rounded-md shadow-2xs overflow-hidden">
        {/* Table Header with Filter Pills */}
        <div className="p-4 bg-[#FAF6EE] border-b border-[#E8E2D5] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#D96B27]" />
            <h2 className="text-sm font-serif font-bold text-[#2C2623]">
              Active Parameters & Heuristic Matrix
            </h2>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1 bg-white border border-[#E8E2D5] rounded-sm p-0.5 text-xs font-mono">
            {[
              { id: "ALL", label: `All (${activeParamsCount})` },
              { id: "CORE", label: "Core PRD (6)" },
              { id: "CUSTOM", label: `Custom Rules (${formState.customRules?.length || 0})` }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterCategory(tab.id)}
                className={`px-3 py-1 rounded-xs font-semibold cursor-pointer transition-colors ${
                  filterCategory === tab.id
                    ? "bg-[#D96B27] text-white"
                    : "text-[#746D65] hover:text-[#2C2623]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Parameters List Rows (Full Width) */}
        <div className="divide-y divide-[#EFEAE1]">
          {/* CORE PARAMETER P1 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
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
                    Forwarding &ge; 85% of incoming stolen funds to downstream accounts within 15 minutes.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p1Weight}
                    onChange={(e) => setFormState({ ...formState, p1Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P1", "Pass-Through Velocity", "Forwarding >= 85% funds in 15m", formState.p1Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p1Enabled: !formState.p1Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p1Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p1Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CORE PARAMETER P2 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
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
                    Multiple distinct victim senders (&ge; 5) converging into a single account in short bursts.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p2Weight}
                    onChange={(e) => setFormState({ ...formState, p2Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P2", "Fan-In Centrality", "Multiple victim accounts converging", formState.p2Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p2Enabled: !formState.p2Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p2Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p2Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CORE PARAMETER P3 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
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
                    Slicing incoming funds and dispersing them across 3 to 50 downstream accounts (&ge; 70% outflow).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p3Weight}
                    onChange={(e) => setFormState({ ...formState, p3Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P3", "Fan-Out Smurfing", "Slicing funds to 3-50 downstream accounts", formState.p3Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p3Enabled: !formState.p3Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p3Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p3Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CORE PARAMETER P4 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                  P4
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-[#2C2623] font-serif">Cash-Out & Anomaly Markers</h3>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                  </div>
                  <p className="text-[11px] text-[#746D65] mt-0.5">
                    Terminal cashouts: ATM withdrawals, crypto exchange P2P off-ramps (USDT/Binance), or illegal hawala nodes.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p4Weight}
                    onChange={(e) => setFormState({ ...formState, p4Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P4", "Cash-Out & Crypto", "P2P Crypto or terminal cashout markers", formState.p4Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p4Enabled: !formState.p4Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p4Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p4Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CORE PARAMETER P5 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-sm bg-[#FAF6EE] border border-[#D4CEBF] flex items-center justify-center font-mono font-bold text-xs text-[#D96B27] shrink-0">
                  P5
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-[#2C2623] font-serif">Shared IP & Device Cluster Anomaly</h3>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#EAE4D8] text-[#746D65]">CORE HEURISTIC</span>
                  </div>
                  <p className="text-[11px] text-[#746D65] mt-0.5">
                    Operating from shared headless devices (Linux scripts/emulators) or foreign proxy IP subnets (185.x, 194.x).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p5Weight}
                    onChange={(e) => setFormState({ ...formState, p5Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P5", "IP/Device Cluster", "Foreign IPs and automated devices", formState.p5Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p5Enabled: !formState.p5Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p5Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p5Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CORE PARAMETER P6 */}
          {(filterCategory === "ALL" || filterCategory === "CORE") && (
            <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAF6EE]/40 transition-colors">
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
                    Burst outgoing transactions occurring immediately upon receiving stolen funds.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#746D65] font-mono">Weight:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formState.p6Weight}
                    onChange={(e) => setFormState({ ...formState, p6Weight: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-center bg-[#FAF6EE] border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                  />
                  <span className="text-[11px] text-[#746D65] font-mono">pts</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCloneCoreToCustom("P6", "Burst Hold Time", "Burst outgoing transactions immediately upon receipt", formState.p6Weight)}
                  className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] transition-colors cursor-pointer"
                  title="Clone to Custom Rules to freely edit conditions"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setFormState({ ...formState, p6Enabled: !formState.p6Enabled })}
                  className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                    formState.p6Enabled
                      ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                      : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                  }`}
                >
                  {formState.p6Enabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>
          )}

          {/* CUSTOM USER-ADDED PARAMETERS (P7, P8, P9... P25+) */}
          {(filterCategory === "ALL" || filterCategory === "CUSTOM") &&
            (formState.customRules || []).map((rule, idx) => (
              <div
                key={rule.id || idx}
                className={`p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                  editingRuleId === rule.id
                    ? "bg-[#FFF9F5] border-l-4 border-[#D96B27]"
                    : "bg-[#FAF6EE]/20 hover:bg-[#FAF6EE]/60"
                }`}
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
                      {editingRuleId === rule.id && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs bg-[#D96B27] text-white">
                          NOW EDITING
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#746D65] mt-1">
                      <span>Field: <strong className="text-[#2C2623]">{rule.field}</strong></span>
                      <span>•</span>
                      <span>Condition: <strong className="text-[#2C2623]">{rule.operator}</strong></span>
                      <span>•</span>
                      <span>Value: <strong className="text-[#D96B27]">"{rule.value}"</strong></span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Inline Action Selector (Free Will Edit) */}
                  <select
                    value={rule.action}
                    onChange={(e) => handleInlineActionChange(idx, e.target.value)}
                    className="h-7 bg-white border border-[#D4CEBF] rounded-sm px-1.5 text-[10px] font-mono font-semibold text-[#2C2623] focus:outline-none cursor-pointer"
                  >
                    <option value="FLAG_SUSPICIOUS">Flag Mule</option>
                    <option value="AUTO_FREEZE">Lien Freeze</option>
                    <option value="FILTER_MATCH">Filter Only</option>
                  </select>

                  {/* Inline Points Editor (Free Will Edit) */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[#746D65] font-mono">Pts:</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={rule.points || 20}
                      onChange={(e) => handleInlinePointsChange(idx, e.target.value)}
                      className="w-14 h-7 text-center bg-white border border-[#D4CEBF] rounded-sm text-xs font-mono font-bold text-[#D96B27]"
                    />
                  </div>

                  {/* Edit in Builder Button */}
                  <button
                    type="button"
                    onClick={() => handleStartEdit(rule)}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#D96B27] hover:border-[#D96B27] text-xs font-mono cursor-pointer transition-colors"
                    title="Load into Builder to customize name, field, condition, value, and action"
                  >
                    <Pencil className="w-3 h-3 text-[#D96B27]" />
                    <span>Edit</span>
                  </button>

                  {/* Duplicate / Clone Button */}
                  <button
                    type="button"
                    onClick={() => handleDuplicateRule(rule)}
                    className="p-1.5 rounded-sm bg-white border border-[#D4CEBF] text-[#746D65] hover:text-[#2C2623] hover:bg-[#FAF6EE] transition-colors cursor-pointer"
                    title="Clone / Duplicate this parameter"
                  >
                    <Copy className="w-3 h-3" />
                  </button>

                  {/* Toggle Active / Off */}
                  <button
                    type="button"
                    onClick={() => handleToggleCustomRule(idx)}
                    className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-sm border cursor-pointer ${
                      rule.enabled
                        ? "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]"
                        : "bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]"
                    }`}
                  >
                    {rule.enabled ? "ACTIVE" : "OFF"}
                  </button>

                  {/* Delete Button */}
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

          {/* Empty state for custom filter */}
          {filterCategory === "CUSTOM" && (formState.customRules || []).length === 0 && (
            <div className="p-8 text-center text-xs text-[#746D65] font-mono">
              <p>No custom parameters added yet.</p>
              <p className="mt-1 text-[#9E968D]">
                Use the "Add Forensic Parameter" form above or choose from the 25+ real dataset presets.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
