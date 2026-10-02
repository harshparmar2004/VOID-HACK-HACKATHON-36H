import React, { useState, useEffect, useRef, useCallback } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";

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
import ForensicParametersView from "./components/ForensicParametersView";
import RegisterFIRModal from "./components/RegisterFIRModal";
import ErrorBoundary from "./components/ErrorBoundary";
import { EmptyState, ErrorState, LoadingState } from "./components/States";

import { fetchSystemStatus, fetchVictims, traceVictim } from "./api";

const TABS = ["intake", "vault", "parameters", "scanner", "entities", "dossier", "graph", "trail", "notices", "brief", "jury"];

// Display filters. They trim what is shown; scoring and tracing use the active profile.
const FILTER_DEFAULTS = { minAmount: 0, maxHops: null, minRisk: 0, bankFilter: "ALL", narrationKeyword: "" };

const EMPTY_TRACE = { victim: null, data: null, loading: false, error: null, notFound: false, serverMs: null };

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function store(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {
    // storage unavailable: the choice simply is not remembered
  }
}

function storedFilters() {
  try {
    const saved = JSON.parse(readStored("abhedya_forensic_params") || "{}");
    const picked = {};
    Object.keys(FILTER_DEFAULTS).forEach((k) => {
      if (saved[k] !== undefined) picked[k] = saved[k];
    });
    return { ...FILTER_DEFAULTS, ...picked };
  } catch (e) {
    return { ...FILTER_DEFAULTS };
  }
}

// Shows the trace-dependent view only when there is a trace to show.
function TraceGate({ trace, onRetry, children }) {
  if (trace.loading) return <LoadingState label={`Tracing ${trace.victim || "victim"}...`} />;
  if (trace.error) return <ErrorState title="The trace could not be loaded" message={trace.error} onRetry={onRetry} />;
  if (!trace.victim) {
    return <EmptyState title="No victim selected" hint="Pick a victim account in the header to trace its money trail." />;
  }
  if (trace.notFound) {
    return <EmptyState title="No transaction graph found" hint={`The engine has no transaction graph for account ${trace.victim}.`} />;
  }
  if (!trace.data?.nodes?.length) {
    return (
      <EmptyState
        title={`No money trail for ${trace.victim}`}
        hint="The current display filters leave no accounts of this trace to show."
      />
    );
  }
  return children(trace.data);
}

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = readStored("abhedya_active_tab");
    return TABS.includes(saved) ? saved : "intake";
  });
  const [status, setStatus] = useState({ data: null, loading: true, error: null });
  const [victims, setVictims] = useState({ accounts: [], items: [], loading: true, error: null });
  const [activeCase, setActiveCase] = useState(() => readStored("abhedya_active_case") || "");
  // Officer-entered reference for the open case. Kept in this browser session only.
  const [caseInfo, setCaseInfo] = useState({ firNumber: "", complainant: "" });
  const [trace, setTrace] = useState(EMPTY_TRACE);
  const [forensicParams, setForensicParams] = useState(storedFilters);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const traceRequest = useRef(0);

  const loadTrace = useCallback(async (victimId, params) => {
    const id = String(victimId || "").trim().toUpperCase();
    if (!id) {
      setTrace(EMPTY_TRACE);
      return;
    }
    const requestNo = ++traceRequest.current;
    setTrace({ ...EMPTY_TRACE, victim: id, loading: true });
    try {
      const { data, serverMs } = await traceVictim(id, params);
      if (requestNo !== traceRequest.current) return;
      // found=false is the API's answer for an account it has no graph for.
      const notFound = data?.found === false;
      const hasNodes = !notFound && Array.isArray(data?.nodes) && data.nodes.length > 0;
      setTrace({ ...EMPTY_TRACE, victim: id, data: hasNodes ? data : null, notFound, serverMs });
    } catch (err) {
      if (requestNo !== traceRequest.current) return;
      setTrace({ ...EMPTY_TRACE, victim: id, error: err.message });
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      setStatus({ data: await fetchSystemStatus(), loading: false, error: null });
    } catch (err) {
      setStatus({ data: null, loading: false, error: err.message });
    }
  }, []);

  const loadVictims = useCallback(async () => {
    setVictims((v) => ({ ...v, loading: true, error: null }));
    try {
      const res = await fetchVictims();
      const accounts = Array.isArray(res?.victims) ? res.victims : [];
      setVictims({ accounts, items: Array.isArray(res?.items) ? res.items : [], loading: false, error: null });
      return accounts;
    } catch (err) {
      setVictims({ accounts: [], items: [], loading: false, error: err.message });
      return null;
    }
  }, []);

  const selectCase = useCallback((victimId, info = null) => {
    const id = String(victimId || "").trim().toUpperCase();
    setActiveCase(id);
    store("abhedya_active_case", id || null);
    setCaseInfo(info || { firNumber: "", complainant: "" });
    loadTrace(id, forensicParams);
  }, [loadTrace, forensicParams]);

  const loadAll = useCallback(async () => {
    loadStatus();
    const accounts = await loadVictims();
    if (accounts === null) return;
    const saved = readStored("abhedya_active_case");
    const initial = saved && accounts.includes(saved) ? saved : accounts[0] || "";
    setActiveCase(initial);
    store("abhedya_active_case", initial || null);
    loadTrace(initial, forensicParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus, loadVictims, loadTrace]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    store("abhedya_active_tab", tab);
  };

  const handleSaveParams = (next) => {
    const merged = { ...FILTER_DEFAULTS, ...next };
    setForensicParams(merged);
    store("abhedya_forensic_params", JSON.stringify(merged));
    if (activeCase) loadTrace(activeCase, merged);
  };

  const handleRegisterCase = (form) => {
    selectCase(form.accountNumber, { firNumber: form.firNumber, complainant: form.complainant });
    handleTabChange("trail");
  };

  const retryTrace = () => loadTrace(activeCase, forensicParams);
  const filtersActive =
    Number(forensicParams.minAmount) > 0 ||
    Number(forensicParams.minRisk) > 0 ||
    forensicParams.maxHops !== null ||
    forensicParams.bankFilter !== "ALL" ||
    Boolean(forensicParams.narrationKeyword);

  const show = (tab) => (activeTab === tab ? "block" : "hidden");

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-[#FBF7EE] text-[#2C2623] flex flex-col font-sans">
      <Header
        activeCase={activeCase}
        victims={victims}
        onSelectCase={(id) => selectCase(id)}
        trace={trace}
        status={status}
        caseInfo={caseInfo}
        onRetry={loadAll}
        onOpenNotices={() => handleTabChange("notices")}
        onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar activeTab={activeTab} onSelectTab={handleTabChange} status={status} filtersActive={filtersActive} />

        {/* Views stay mounted so their own state survives tab changes. */}
        <main className="flex-1 p-6 overflow-y-auto min-h-0 max-w-7xl mx-auto w-full">
          <div className={show("intake")}>
            <ErrorBoundary name="Case Intake">
              <CaseIntakeView
                status={status}
                victims={victims}
                activeCase={activeCase}
                trace={trace}
                onReload={loadAll}
                onSelectCase={(id) => {
                  selectCase(id);
                  handleTabChange("trail");
                }}
                onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
              />
            </ErrorBoundary>
          </div>

          <div className={show("vault")}>
            <ErrorBoundary name="Evidence Vault">
              <EvidenceVaultView status={status} trace={trace} onRetry={loadStatus} />
            </ErrorBoundary>
          </div>

          <div className={show("parameters")}>
            <ErrorBoundary name="Forensic Parameters">
              <ForensicParametersView
                forensicParams={forensicParams}
                defaults={FILTER_DEFAULTS}
                onSaveParams={handleSaveParams}
              />
            </ErrorBoundary>
          </div>

          <div className={show("scanner")}>
            <ErrorBoundary name="Fraud Scanner">
              <RealtimeFraudScannerView
                forensicParams={forensicParams}
                onTraceVictim={(id) => {
                  selectCase(id);
                  handleTabChange("trail");
                }}
              />
            </ErrorBoundary>
          </div>

          <div className={show("entities")}>
            <ErrorBoundary name="Entity Directory">
              <EntityDirectoryView forensicParams={forensicParams} />
            </ErrorBoundary>
          </div>

          <div className={show("dossier")}>
            <ErrorBoundary name="Mule Dossier">
              <MuleDossierView forensicParams={forensicParams} onNavigateTab={handleTabChange} />
            </ErrorBoundary>
          </div>

          <div className={show("graph")}>
            <ErrorBoundary name="Mule Network Graph">
              <TraceGate trace={trace} onRetry={retryTrace}>
                {(data) => <NetworkGraphView key={trace.victim} traceData={data} serverMs={trace.serverMs} isActive={activeTab === "graph"} />}
              </TraceGate>
            </ErrorBoundary>
          </div>

          <div className={show("trail")}>
            <ErrorBoundary name="Endpoint Trail">
              <EndpointTrailView
                victimAccount={activeCase}
                onSearchVictim={(id) => selectCase(id)}
                trace={trace}
                onRetry={retryTrace}
                onNavigateToNotices={() => handleTabChange("notices")}
                isActive={activeTab === "trail"}
              />
            </ErrorBoundary>
          </div>

          <div className={show("notices")}>
            <ErrorBoundary name="Section 91 Notices">
              <Section91NoticesView trace={trace} onRetry={retryTrace} />
            </ErrorBoundary>
          </div>

          <div className={show("brief")}>
            <ErrorBoundary name="Investigative Brief">
              <CaseDiaryView trace={trace} caseInfo={caseInfo} onRetry={retryTrace} />
            </ErrorBoundary>
          </div>

          <div className={show("jury")}>
            <ErrorBoundary name="Audit & Evaluation">
              <JuryBenchmarkView />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <RegisterFIRModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onRegisterCase={handleRegisterCase}
        victimAccounts={victims.accounts}
      />

      <footer className="w-full bg-[#FAF6EE] border-t border-[#E8E2D5] px-6 py-2.5 text-[11px] text-[#746D65] flex flex-wrap items-center justify-between font-mono gap-2">
        <div>
          <b>Legal basis:</b> Sec 91 Cr.P.C., 1973 &amp; Sec 94 BNSS, 2023
        </div>
        <div>
          <b>Engine:</b> embedded DuckDB, offline
          {status.data?.profile_id ? ` • scoring profile ${status.data.profile_id}` : ""}
        </div>
      </footer>
    </div>
  );
}
