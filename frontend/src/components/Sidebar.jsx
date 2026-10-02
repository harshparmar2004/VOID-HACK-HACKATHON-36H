import React, { useState, useEffect, useMemo } from "react";
import {
  UploadCloud,
  Shield,
  Users,
  UserX,
  Share2,
  GitCommit,
  Layers,
  FileCheck,
  FileText,
  Award,
  Settings,
  Zap,
  SlidersHorizontal,
  Filter,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Building,
  Activity,
  Search,
  Sparkles
} from "lucide-react";

export default function Sidebar({
  activeTab,
  onSelectTab,
  counts,
  onOpenSettings,
  forensicParams = {
    minAmount: 0,
    maxHops: 4,
    timeWindow: 180,
    minRisk: 0,
    bankFilter: "ALL",
    narrationKeyword: "",
    deviceFilter: "ALL"
  },
  onSaveParams
}) {
  const [paramsExpanded, setParamsExpanded] = useState(true);
  const [formState, setFormState] = useState(forensicParams);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (forensicParams) {
      setFormState(forensicParams);
    }
  }, [forensicParams]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (Number(formState.minAmount) > 0) count++;
    if (Number(formState.maxHops) !== 4) count++;
    if (Number(formState.timeWindow) !== 180) count++;
    if (Number(formState.minRisk) > 0) count++;
    if (formState.bankFilter && formState.bankFilter !== "ALL") count++;
    if (formState.narrationKeyword && formState.narrationKeyword.trim() !== "") count++;
    if (formState.deviceFilter && formState.deviceFilter !== "ALL") count++;
    return count;
  }, [formState]);

  const formatRupee = (val) => {
    const num = Number(val) || 0;
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)} L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(0)}K`;
    if (num > 0) return `₹${num.toLocaleString('en-IN')}`;
    return "All Amounts";
  };

  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (onSaveParams) {
      onSaveParams(formState);
    }
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2200);
  };

  const handleReset = () => {
    const defaults = {
      minAmount: 0,
      maxHops: 4,
      timeWindow: 180,
      minRisk: 0,
      bankFilter: "ALL",
      narrationKeyword: "",
      deviceFilter: "ALL"
    };
    setFormState(defaults);
    if (onSaveParams) {
      onSaveParams(defaults);
    }
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2200);
  };

  const navSections = [
    {
      title: "CASE OPERATIONS",
      items: [
        { id: "intake", label: "Case Intake", icon: UploadCloud, badge: null },
        { id: "vault", label: "Evidence Vault", icon: Shield, badge: "SHA-256" }
      ]
    },
    {
      title: "FORENSIC ANALYSIS",
      items: [
        { id: "scanner", label: "Real-Time 60s Scanner", icon: Zap, badge: "60s / 2M" },
        { id: "entities", label: "Entity Directory", icon: Users, badge: counts?.totalAccounts || "24,368" },
        { id: "dossier", label: "Mule Dossier", icon: UserX, badge: counts?.flaggedMules || "333" },
        { id: "graph", label: "Mule Network Graph", icon: Share2, badge: "WebGL" },
        { id: "trail", label: "Endpoint Trail", icon: GitCommit, badge: "4 Hops" },
        { id: "patterns", label: "Patterns & Story", icon: Layers, badge: null }
      ]
    },
    {
      title: "LEGAL & BENCHMARK",
      items: [
        { id: "notices", label: "Section 91 Notices", icon: FileCheck, badge: counts?.noticesCount || "Bank Lien" },
        { id: "brief", label: "Investigative Brief", icon: FileText, badge: "CrPC" },
        { id: "jury", label: "Audit & Evaluation", icon: Award, badge: "Blind Test" }
      ]
    }
  ];

  return (
    <aside className="w-72 bg-[#FBF7EE] border-r border-[#E8E2D5] h-full overflow-y-auto flex flex-col justify-between p-3.5 shrink-0 select-none space-y-4">
      <div className="space-y-5">
        {/* Navigation Sections */}
        {navSections.map((section, sIdx) => (
          <div key={section.title} className="space-y-1">
            <div className="text-[10px] font-bold tracking-widest text-[#9E968D] uppercase px-3 mb-1.5 font-mono">
              {section.title}
            </div>
            <nav className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      isActive
                        ? "bg-[#F3EDE2] text-[#D96B27] font-semibold shadow-2xs border border-[#E4DBD0]"
                        : "text-[#746D65] hover:bg-[#F6F1E8] hover:text-[#2C2623]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? "text-[#D96B27]" : "text-[#9E968D]"}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                          isActive
                            ? "bg-[#D96B27] text-white"
                            : "bg-[#EAE4D8] text-[#746D65]"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* DEDICATED EDITABLE PARAMETERS SECTION - PLACED DIRECTLY UNDER CASE OPERATIONS */}
            {sIdx === 0 && (
              <div className="pt-2">
                <div className="bg-white border border-[#E8E2D5] rounded-2xl p-3 shadow-2xs transition-all">
                  {/* Collapsible Section Header */}
                  <div
                    onClick={() => setParamsExpanded(!paramsExpanded)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[#D96B27]">
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-[#2C2623] uppercase tracking-wider font-mono">
                          Investigation Filters
                        </div>
                        <div className="text-[10px] text-[#9E968D]">
                          {activeFilterCount > 0 ? (
                            <span className="text-[#D96B27] font-semibold">{activeFilterCount} Active Filters</span>
                          ) : (
                            "Editable Parameters"
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {activeFilterCount > 0 && (
                        <span className="w-2 h-2 rounded-full bg-[#D96B27] animate-pulse"></span>
                      )}
                      {paramsExpanded ? (
                        <ChevronUp className="w-4 h-4 text-[#9E968D]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[#9E968D]" />
                      )}
                    </div>
                  </div>

                  {/* Active Filter Quick Badges when collapsed */}
                  {!paramsExpanded && activeFilterCount > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#EFEAE1] flex flex-wrap gap-1">
                      {Number(formState.minAmount) > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                          ≥{formatRupee(formState.minAmount)}
                        </span>
                      )}
                      {Number(formState.maxHops) !== 4 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                          {formState.maxHops} Hops
                        </span>
                      )}
                      {formState.bankFilter !== "ALL" && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                          {formState.bankFilter}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Editable Form Controls */}
                  {paramsExpanded && (
                    <form onSubmit={handleSave} className="space-y-2.5 pt-3 mt-2 border-t border-[#EFEAE1]">
                      {/* Parameter 1: Min Amount Threshold */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          <span>MIN TXN AMOUNT (INR)</span>
                          <span className="text-[#D96B27] font-bold">{formatRupee(formState.minAmount)}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1000"
                          value={formState.minAmount}
                          onChange={(e) => setFormState({ ...formState, minAmount: Number(e.target.value) || 0 })}
                          placeholder="e.g. 50000 or 25000000"
                          className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                        />
                        {/* Quick Presets */}
                        <div className="grid grid-cols-4 gap-1 mt-1 text-[9px] font-mono">
                          {[
                            { label: "All", val: 0 },
                            { label: "₹50K", val: 50000 },
                            { label: "₹1L", val: 100000 },
                            { label: "₹1Cr+", val: 10000000 }
                          ].map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => setFormState({ ...formState, minAmount: p.val })}
                              className={`py-0.5 rounded border transition-colors ${
                                Number(formState.minAmount) === p.val
                                  ? "bg-[#D96B27] text-white border-[#D96B27] font-bold"
                                  : "bg-white text-[#746D65] border-[#E8E2D5] hover:border-[#D96B27]"
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Parameter 2: Max Hop Depth */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          <span>MAX HOP DEPTH</span>
                          <span className="text-[#2C2623] font-bold">{formState.maxHops} Hops</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {[1, 2, 3, 4, 5].map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => setFormState({ ...formState, maxHops: h })}
                              className={`py-1 rounded-xl text-xs font-mono transition-colors border ${
                                Number(formState.maxHops) === h
                                  ? "bg-[#2C2623] text-white border-[#2C2623] font-bold shadow-2xs"
                                  : "bg-[#FAF6EE] text-[#746D65] border-[#E8E2D5] hover:border-[#D96B27]"
                              }`}
                            >
                              {h}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Parameter 3: Velocity Time Window */}
                      <div>
                        <div className="text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          VELOCITY DISPERSION WINDOW
                        </div>
                        <select
                          value={formState.timeWindow}
                          onChange={(e) => setFormState({ ...formState, timeWindow: Number(e.target.value) })}
                          className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                        >
                          <option value={30}>30 Mins (Rapid Bunny-Hop)</option>
                          <option value={60}>60 Mins (High Velocity)</option>
                          <option value={180}>180 Mins (3h Standard Investigation)</option>
                          <option value={360}>360 Mins (6 Hours)</option>
                          <option value={1440}>1,440 Mins (24 Hours Full Day)</option>
                        </select>
                      </div>

                      {/* Parameter 4: Target Bank Filter */}
                      <div>
                        <div className="text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          BANK / IFSC ROUTING
                        </div>
                        <select
                          value={formState.bankFilter}
                          onChange={(e) => setFormState({ ...formState, bankFilter: e.target.value })}
                          className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                        >
                          <option value="ALL">All Banks (Multi-Bank)</option>
                          <option value="PYTM">Paytm Payments Bank (PYTM)</option>
                          <option value="IPOS">India Post Payments Bank (IPOS)</option>
                          <option value="AXIS">Axis Bank (AXIS / UTIB)</option>
                          <option value="PUNB">Punjab National Bank (PUNB)</option>
                          <option value="BARB">Bank of Baroda (BARB)</option>
                          <option value="SBIN">State Bank of India (SBIN)</option>
                          <option value="HDFC">HDFC Bank (HDFC)</option>
                          <option value="ICIC">ICICI Bank (ICIC)</option>
                          <option value="KKBK">Kotak Mahindra Bank (KKBK)</option>
                        </select>
                      </div>

                      {/* Parameter 5: Minimum Mule Risk Score */}
                      <div>
                        <div className="text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          MINIMUM MULE RISK SCORE
                        </div>
                        <select
                          value={formState.minRisk}
                          onChange={(e) => setFormState({ ...formState, minRisk: Number(e.target.value) })}
                          className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                        >
                          <option value={0}>0+ (All Transacting Accounts)</option>
                          <option value={60}>60+ (Medium Risk Accounts)</option>
                          <option value={75}>75+ (Suspected Mules)</option>
                          <option value={85}>85+ (High Confidence Mules Only)</option>
                          <option value={95}>95+ (Critical Smurfing Exit)</option>
                        </select>
                      </div>

                      {/* Parameter 6: Narration Keyword */}
                      <div>
                        <div className="text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          SCAM / NARRATION KEYWORD
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="e.g. CRYPTO, TASK, ARREST..."
                            value={formState.narrationKeyword}
                            onChange={(e) => setFormState({ ...formState, narrationKeyword: e.target.value })}
                            className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                          />
                          {formState.narrationKeyword && (
                            <button
                              type="button"
                              onClick={() => setFormState({ ...formState, narrationKeyword: "" })}
                              className="absolute right-2.5 top-2 text-[10px] font-bold text-[#9E968D] hover:text-[#2C2623]"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Parameter 7: Anomalous Device / IP */}
                      <div>
                        <div className="text-[10px] font-semibold text-[#746D65] mb-1 font-mono">
                          IP & DEVICE TELEMETRY
                        </div>
                        <select
                          value={formState.deviceFilter}
                          onChange={(e) => setFormState({ ...formState, deviceFilter: e.target.value })}
                          className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                        >
                          <option value="ALL">All Network Traffic</option>
                          <option value="FOREIGN_IP">Foreign Proxies Only (185.*, 194.*)</option>
                          <option value="EMULATOR_SCRIPT">Emulators & Linux Scripts Only</option>
                        </select>
                      </div>

                      {/* Save & Reset Action Buttons */}
                      <div className="pt-2 space-y-1.5">
                        <button
                          type="submit"
                          className="w-full bg-[#D96B27] hover:bg-[#C25A1E] text-white py-2 px-3 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Save & Apply Parameters</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleReset}
                          className="w-full bg-transparent hover:bg-[#FAF6EE] text-[#746D65] hover:text-[#2C2623] py-1.5 px-3 rounded-xl text-[11px] font-semibold transition-all border border-transparent hover:border-[#E8E2D5] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset to Defaults</span>
                        </button>
                      </div>

                      {/* Toast Notification */}
                      {savedToast && (
                        <div className="p-2 rounded-xl bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] text-[10px] font-semibold flex items-center gap-1.5 animate-fadeIn">
                          <Check className="w-3.5 h-3.5 shrink-0" />
                          <span>Filters saved! Active across all views & future CSV/Sheet uploads.</span>
                        </div>
                      )}

                      <div className="text-[9px] text-[#9E968D] text-center pt-1 font-mono">
                        Auto-applied to uploaded CSVs & Google Sheet links
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Settings Action Button */}
      <div className="pt-2">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white hover:bg-[#F5EDE1] border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold transition-all shadow-2xs cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#D96B27] group-hover:rotate-45 transition-transform" />
            <span>LLM & JEV Settings</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3EDE2] text-[#746D65] border border-[#E8E2D5] font-mono">
            API Keys
          </span>
        </button>
      </div>

      {/* Local System Info Footer */}
      <div className="pt-3 border-t border-[#E8E2D5] text-[11px] text-[#9E968D] space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>Local Engine:</span>
          <span className="text-[#059669] font-semibold">DuckDB v1.5</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Records Indexed:</span>
          <span className="text-[#2C2623] font-bold">2,000,000</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Network Compute:</span>
          <span className="text-[#D96B27] font-semibold">100% Offline</span>
        </div>
      </div>
    </aside>
  );
}

