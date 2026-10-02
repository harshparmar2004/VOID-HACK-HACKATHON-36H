import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";

// 10 Distinct Forensic Feature Views (Zero duplicates!)
import CaseIntakeView from "./components/CaseIntakeView";
import EvidenceVaultView from "./components/EvidenceVaultView";
import EntityDirectoryView from "./components/EntityDirectoryView";
import MuleDossierView from "./components/MuleDossierView";
import NetworkGraphView from "./components/NetworkGraphView";
import EndpointTrailView from "./components/EndpointTrailView";
import Section91NoticesView from "./components/Section91NoticesView";
import CaseDiaryView from "./components/CaseDiaryView";
import JuryBenchmarkView from "./components/JuryBenchmarkView";
import RealtimeFraudScannerView from "./components/RealtimeFraudScannerView";
import HamiHoppingView from "./components/HamiHoppingView";
import ForensicParametersView from "./components/ForensicParametersView";
import RegisterFIRModal from "./components/RegisterFIRModal";
import SettingsModal from "./components/SettingsModal";
import ErrorBoundary from "./components/ErrorBoundary";

import { MessageSquare, X, Send, Bot, ShieldAlert } from "lucide-react";

import {
  DEFAULT_VICTIM,
  DEFAULT_TRACE,
  DEFAULT_NOTICES,
  DEFAULT_DIARY,
  DEFAULT_MULES
} from "./mockData";

import {
  fetchSystemStatus,
  fetchVictims,
  traceVictim,
  fetchMules,
  fetchBankNotices,
  fetchCaseDiary
} from "./api";

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem("abhedya_active_tab");
    if (saved === "timeline" || saved === "patterns") return "intake";
    return saved || "intake";
  });
  const [activeCase, setActiveCase] = useState(() => {
    return localStorage.getItem("abhedya_active_case") || DEFAULT_VICTIM;
  });
  const [victimName, setVictimName] = useState(() => {
    return localStorage.getItem("abhedya_victim_name") || "Sunil Kumar Verma";
  });
  const [mobileNumber, setMobileNumber] = useState("+91 9811000001");
  const [firNumber, setFirNumber] = useState("FIR-0142/2026/CYBER-INDORE");
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cases, setCases] = useState(["KKBK10000000", "SBIN10000294", "AXIS10000018", "HDFC10000062", "SBIN10000268"]);
  const [systemStatus, setSystemStatus] = useState({
    status: "ready",
    system_name: "Operation Abhedya-Chakra",
    records_parsed: 2000000,
    total_volume_inr: 45343098275.88,
    vault_verified: true
  });
  const [traceData, setTraceData] = useState(DEFAULT_TRACE);
  const [mules, setMules] = useState(DEFAULT_MULES);
  const [muleFilter, setMuleFilter] = useState(null);
  const [noticesData, setNoticesData] = useState(DEFAULT_NOTICES);
  const [diaryData, setDiaryData] = useState(DEFAULT_DIARY);
  const [loading, setLoading] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [activeIngestResult, setActiveIngestResult] = useState(() => {
    try {
      const saved = localStorage.getItem("abhedya_ingest_result");
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [chatMessages, setChatMessages] = useState([
    {
      sender: "ai",
      text: "Namaste Officer. I am your Type-Safe Forensic Assistant. I have correlated 2,000,000 banking transactions for Case FIR-0142/2026/CYBER-INDORE. How can I assist with this money trail or Section 91 freeze orders?"
    }
  ]);
  const [chatInput, setChatInput] = useState("");

  const [forensicParams, setForensicParams] = useState(() => {
    try {
      const saved = localStorage.getItem("abhedya_forensic_params");
      return saved ? {
        minAmount: 0,
        maxHops: 4,
        timeWindow: 180,
        minRisk: 0,
        bankFilter: "ALL",
        narrationKeyword: "",
        deviceFilter: "ALL",
        ...JSON.parse(saved)
      } : {
        minAmount: 0,
        maxHops: 4,
        timeWindow: 180,
        minRisk: 0,
        bankFilter: "ALL",
        narrationKeyword: "",
        deviceFilter: "ALL"
      };
    } catch (e) {
      return {
        minAmount: 0,
        maxHops: 4,
        timeWindow: 180,
        minRisk: 0,
        bankFilter: "ALL",
        narrationKeyword: "",
        deviceFilter: "ALL"
      };
    }
  });

  const handleSaveParams = async (newParams) => {
    setForensicParams(newParams);
    try {
      localStorage.setItem("abhedya_forensic_params", JSON.stringify(newParams));
    } catch (e) {}

    // Reload active case trail with new parameters
    loadCaseData(activeCase, newParams);

    // Reload mules with new parameters
    try {
      const muleList = await fetchMules(100, muleFilter, newParams.minRisk, newParams.minAmount, newParams.bankFilter);
      if (muleList && Array.isArray(muleList)) {
        setMules(muleList);
      }
    } catch (e) {
      console.warn("Could not reload mules with new parameters:", e);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem("abhedya_active_tab", tab);
    } catch (e) {}
  };

  const handleUpdateIngestResult = (res) => {
    setActiveIngestResult(res);
    try {
      if (res) {
        localStorage.setItem("abhedya_ingest_result", JSON.stringify(res));
      } else {
        localStorage.removeItem("abhedya_ingest_result");
      }
    } catch (e) {}
  };

  // Load live data on mount and auto-retry if backend is warming up
  useEffect(() => {
    async function loadInitial() {
      try {
        const status = await fetchSystemStatus();
        if (status) setSystemStatus(status);
        
        const victimsList = await fetchVictims();
        if (victimsList?.victims?.length) {
          setCases(victimsList.victims);
          const savedCase = localStorage.getItem("abhedya_active_case");
          const initialCase = savedCase && victimsList.victims.includes(savedCase)
            ? savedCase
            : victimsList.victims[0];
          setActiveCase(initialCase);
          localStorage.setItem("abhedya_active_case", initialCase);
          loadCaseData(initialCase, forensicParams);
        } else {
          loadCaseData(activeCase, forensicParams);
        }
        
        const muleList = await fetchMules(100, muleFilter, forensicParams.minRisk, forensicParams.minAmount, forensicParams.bankFilter);
        if (muleList && Array.isArray(muleList) && muleList.length > 0) {
          setMules(muleList);
        }
      } catch (err) {
        console.warn("Backend warming up, using seed state:", err.message);
        setTimeout(loadInitial, 1500);
      }
    }
    loadInitial();
  }, []);

  const handleFilterMuleRole = async (role) => {
    setMuleFilter(role);
    try {
      const muleList = await fetchMules(100, role, forensicParams.minRisk, forensicParams.minAmount, forensicParams.bankFilter);
      if (muleList && Array.isArray(muleList) && muleList.length > 0) {
        setMules(muleList);
      }
    } catch (err) {
      console.warn("Using active mules for filter:", role);
    }
  };

  const loadCaseData = async (victimId, params = forensicParams) => {
    setLoading(true);
    try {
      const p = params || forensicParams;
      const trace = await traceVictim(
        victimId,
        p.maxHops,
        p.timeWindow,
        p.minAmount,
        p.bankFilter,
        p.narrationKeyword,
        p.customRules
      );
      if (trace && trace.nodes) setTraceData(trace);
      
      const notices = await fetchBankNotices(victimId);
      if (notices && notices.notices) setNoticesData(notices);
      
      const diary = await fetchCaseDiary(victimId);
      if (diary && diary.case_diary) setDiaryData(diary);
    } catch (err) {
      console.warn("Using active trace for victim:", victimId);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCase = (victimId) => {
    setActiveCase(victimId);
    try {
      localStorage.setItem("abhedya_active_case", victimId);
    } catch (e) {}
    loadCaseData(victimId);
  };

  const handleRefreshAll = async (newVictimId = null) => {
    try {
      const status = await fetchSystemStatus();
      if (status) setSystemStatus(status);
      
      const victimsList = await fetchVictims();
      if (victimsList?.victims?.length) {
        setCases(victimsList.victims);
      }
      
      const targetVictim = newVictimId || activeCase || victimsList?.victims?.[0];
      if (targetVictim) {
        setActiveCase(targetVictim);
        try {
          localStorage.setItem("abhedya_active_case", targetVictim);
        } catch (e) {}
        loadCaseData(targetVictim, forensicParams);
      }
      
      const muleList = await fetchMules(100, muleFilter, forensicParams.minRisk, forensicParams.minAmount, forensicParams.bankFilter);
      if (muleList?.length) setMules(muleList);
    } catch (err) {
      console.warn("Refresh error:", err.message);
    }
  };

  const handleRegisterCase = (formData) => {
    setVictimName(formData.victimName);
    setMobileNumber(formData.mobile);
    setFirNumber(formData.firNumber);
    setActiveCase(formData.accountNumber);
    try {
      localStorage.setItem("abhedya_active_case", formData.accountNumber);
      localStorage.setItem("abhedya_victim_name", formData.victimName);
    } catch (e) {}
    loadCaseData(formData.accountNumber, forensicParams);
    handleTabChange("trail"); // Instantly navigate officer to the multi-hop trace!
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const userText = chatInput;
    setChatMessages((prev) => [...prev, { sender: "user", text: userText }]);
    setChatInput("");
    
    try {
      const res = await fetch("http://127.0.0.1:8000/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          victim_account: activeCase
        })
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [...prev, { sender: "ai", text: data.reply }]);
        return;
      }
    } catch (err) {
      console.warn("Backend chat endpoint fallback:", err.message);
    }

    setTimeout(() => {
      let reply = "The transaction hop analysis shows high-velocity dispersion. Funds from the victim account were split across Layer 2 distributor mules within 7 minutes. Section 91 notices are prepared for immediate bank lien.";
      if (userText.toLowerCase().includes("freeze") || userText.toLowerCase().includes("notice")) {
        reply = `I have generated ${noticesData?.notices?.length || 7} bank freezing notices totaling ₹${traceData?.recoverable_holding_inr?.toLocaleString('en-IN')}. The primary holding accounts are located in State Bank of India, Axis Bank, and Union Bank of India.`;
      } else if (userText.toLowerCase().includes("mule") || userText.toLowerCase().includes("smurf")) {
        reply = `The syndicate operates in 3 distinct layers: L1 Collector received the lump sum, sliced it into 14 distributor mules (Hop 2), which then attempted exit via crypto P2P USDT on foreign IPs 185.x.x.x.`;
      }
      setChatMessages((prev) => [...prev, { sender: "ai", text: reply }]);
    }, 400);
  };

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[#FBF7EE] text-[#2C2623] flex flex-col font-sans">
      {/* Top Header */}
      <Header
        activeCase={activeCase}
        cases={cases}
        onSelectCase={handleSelectCase}
        totalSiphoned={traceData?.total_siphoned_inr}
        onExportPdf={() => handleTabChange("notices")}
        onOpenAssistant={() => setAssistantOpen(true)}
        onOpenSettings={() => handleTabChange("jury")}
        activeTab={activeTab}
        systemStatus={systemStatus}
        victimName={victimName}
        firNumber={firNumber}
        onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
      />

      {/* Main Split Layout: Left Navigation + Right Feature Execution Canvas */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Navigation Sidebar with Dedicated Editable Parameters Section */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleTabChange}
          onOpenSettings={() => handleTabChange("jury")}
          forensicParams={forensicParams}
          onSaveParams={handleSaveParams}
          counts={{
            totalAccounts: "24,368",
            flaggedMules: mules.length ? String(mules.length) : "333",
            noticesCount: noticesData?.notices?.length ? `${noticesData.notices.length} Banks` : "7 Banks"
          }}
        />

        {/* Right Feature Execution Canvas (Persistent Mount to Prevent State Wipeout) */}
        <main className="flex-1 p-6 overflow-y-auto min-h-0 max-w-7xl mx-auto w-full">
          {/* TAB 1: Case Intake */}
          <div className={activeTab === "intake" ? "block" : "hidden"}>
            <ErrorBoundary name="Case Intake">
              <CaseIntakeView
                victimAccount={activeCase}
                victimName={victimName}
                mobileNumber={mobileNumber}
                firNumber={firNumber}
                totalSiphoned={traceData?.total_siphoned_inr}
                systemStatus={systemStatus}
                forensicParams={forensicParams}
                onTraceNow={() => handleTabChange("trail")}
                onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
                onSelectCase={handleSelectCase}
                onNavigateTab={handleTabChange}
                onRefreshData={handleRefreshAll}
                activeIngestResult={activeIngestResult}
                onUpdateIngestResult={handleUpdateIngestResult}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 2: Evidence Vault (Dedicated Chained Custody Ledger) */}
          <div className={activeTab === "vault" ? "block" : "hidden"}>
            <ErrorBoundary name="Evidence Vault">
              <EvidenceVaultView />
            </ErrorBoundary>
          </div>

          {/* TAB: Forensic Parameters & PRD P1-P10 Heuristics Setup */}
          <div className={activeTab === "parameters" ? "block" : "hidden"}>
            <ErrorBoundary name="Forensic Parameters Setup">
              <ForensicParametersView
                forensicParams={forensicParams}
                onSaveParams={handleSaveParams}
                activeCase={activeCase}
                onNavigateTab={handleTabChange}
                onSelectCase={handleSelectCase}
              />
            </ErrorBoundary>
          </div>

          {/* Real-Time 60s 2M Fraud Scanner & Early Intercept Monitor */}
          <div className={activeTab === "scanner" ? "block" : "hidden"}>
            <ErrorBoundary name="Real-Time 2M Fraud Scanner">
              <RealtimeFraudScannerView
                onNavigateTab={handleTabChange}
                onSelectCase={handleSelectCase}
                forensicParams={forensicParams}
              />
            </ErrorBoundary>
          </div>

          {/* HAMI AML Detector: Multi-Hop Hopping & GNN Graph Analysis */}
          <div className={activeTab === "hami" ? "block" : "hidden"}>
            <ErrorBoundary name="HAMI AML Hopping">
              <HamiHoppingView
                victimAccount={activeCase}
                onSelectVictim={handleSelectCase}
                onNavigateTab={handleTabChange}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 3: Entity Directory (Master Database Index of 24,368 Accounts) */}
          <div className={activeTab === "entities" ? "block" : "hidden"}>
            <ErrorBoundary name="Entity Directory">
              <EntityDirectoryView 
                totalAccounts="24,368" 
                forensicParams={forensicParams}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 4: Mule Dossier (0-100 Risk Index Table & P1-P6 Heuristics) */}
          <div className={activeTab === "dossier" ? "block" : "hidden"}>
            <ErrorBoundary name="Mule Dossier">
              <MuleDossierView
                mules={mules?.length ? mules : DEFAULT_MULES}
                onFilterRole={handleFilterMuleRole}
                activeFilter={muleFilter}
                forensicParams={forensicParams}
                onNavigateTab={handleTabChange}
                onSelectCase={handleSelectCase}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 5: Mule Network Graph (Interactive WebGL Force Graph) */}
          <div className={activeTab === "graph" ? "block" : "hidden"}>
            <ErrorBoundary name="Mule Network Graph">
              <NetworkGraphView traceData={traceData} />
            </ErrorBoundary>
          </div>

          {/* TAB 6: Endpoint Trail (4-Hop Money Trail & 50-Account Fan-out Smurfing) */}
          <div className={activeTab === "trail" ? "block" : "hidden"}>
            <ErrorBoundary name="Endpoint Trail">
              <EndpointTrailView
                victimAccount={activeCase}
                onSearchVictim={handleSelectCase}
                traceData={traceData}
                loading={loading}
                onNavigateToNotices={() => handleTabChange("notices")}
                isActive={activeTab === "trail"}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 7: Section 91 Notices (Bank-Wise Freezing Orders & Requisitions) */}
          <div className={activeTab === "notices" ? "block" : "hidden"}>
            <ErrorBoundary name="Section 91 Notices">
              <Section91NoticesView
                noticesData={noticesData}
                traceData={traceData}
                victimAccount={activeCase}
                victimName={victimName}
                firNumber={firNumber}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 10: Investigative Brief (Police Case Diary under Sec 172 CrPC) */}
          <div className={activeTab === "brief" ? "block" : "hidden"}>
            <ErrorBoundary name="Investigative Brief">
              <CaseDiaryView
                diaryData={diaryData}
                victimAccount={activeCase}
              />
            </ErrorBoundary>
          </div>

          {/* TAB 11: Audit & Evaluation (1-Click Live Jury Blind Benchmark) */}
          <div className={activeTab === "jury" ? "block" : "hidden"}>
            <ErrorBoundary name="Audit & Evaluation">
              <JuryBenchmarkView />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Forensic Floating Assistant Drawer */}
      {assistantOpen && (
        <div className="fixed bottom-6 right-6 w-96 bg-white border border-[#E8E2D5] rounded-2xl shadow-2xl overflow-hidden z-50 flex flex-col h-[480px]">
          <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#D96B27]" />
              <span className="font-serif font-bold text-xs text-[#2C2623]">Type-Safe Police Assistant</span>
            </div>
            <button
              onClick={() => setAssistantOpen(false)}
              className="text-[#9E968D] hover:text-[#2C2623] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl ${
                  msg.sender === "user"
                    ? "bg-[#D96B27] text-white ml-6"
                    : "bg-[#F3EDE2] text-[#2C2623] mr-6"
                }`}
              >
                {msg.text}
              </div>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="p-2 border-t border-[#E8E2D5] flex gap-2 bg-[#FCFAF5]">
            <input
              type="text"
              placeholder="Ask about money trail or freeze orders..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 bg-white border border-[#E8E2D5] rounded-xl px-3 py-1.5 text-xs text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
            />
            <button
              type="submit"
              className="w-8 h-8 rounded-xl bg-[#D96B27] text-white flex items-center justify-center hover:bg-[#C25B1C] cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Register New FIR Complaint Modal */}
      <RegisterFIRModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onRegisterCase={handleRegisterCase}
      />

      {/* LLM & JEV TypeSafe API Keys Configuration Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Persistent Police Bottom Footer matching reference dashboard */}
      <footer className="w-full bg-[#FAF6EE] border-t border-[#E8E2D5] px-6 py-2.5 text-[11px] text-[#746D65] flex flex-wrap items-center justify-between font-mono gap-2">
        <div>
          <b>Legal:</b> Sec 91 Cr.P.C., 1973 & Sec 94 BNSS, 2023 • <b>Engine:</b> Embedded DuckDB (Pure In-Memory Columnar)
        </div>
        <div>
          <b>Reasoning:</b> TypeSafe AI / Schema-Locked Validator • <b>Void Hacks() 8.0:</b> Indore Police Commissionerate
        </div>
      </footer>
    </div>
  );
}
