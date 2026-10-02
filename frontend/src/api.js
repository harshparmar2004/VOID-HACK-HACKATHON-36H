const API_BASE = "http://127.0.0.1:8000/api";

export async function fetchSystemStatus() {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error("Failed to fetch system status");
  return res.json();
}

export async function fetchVictims() {
  const res = await fetch(`${API_BASE}/victims`);
  if (!res.ok) throw new Error("Failed to fetch victims");
  return res.json();
}

export async function traceVictim(victimAccount, maxHops = 4, timeWindow = 180, minAmount = 0, bankFilter = null, keyword = null, customRules = null) {
  let url = `${API_BASE}/trace/${victimAccount}?max_hops=${maxHops}&time_window=${timeWindow}`;
  if (minAmount > 0) url += `&min_amount=${minAmount}`;
  if (bankFilter && bankFilter !== "ALL") url += `&bank_filter=${encodeURIComponent(bankFilter)}`;
  if (keyword && String(keyword).trim()) url += `&keyword=${encodeURIComponent(String(keyword).trim())}`;
  if (customRules && Array.isArray(customRules) && customRules.length > 0) {
    url += `&custom_rules=${encodeURIComponent(JSON.stringify(customRules))}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to trace victim money trail");
  return res.json();
}

export async function simulateParameters(payload) {
  const res = await fetch(`${API_BASE}/parameters/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to simulate parameters");
  return res.json();
}

export async function fetchMules(limit = 100, role = null, minRisk = 0, minAmount = 0, bankFilter = null) {
  let url = `${API_BASE}/mules?limit=${limit}`;
  if (role) url += `&role_filter=${role}`;
  if (minRisk > 0) url += `&min_risk=${minRisk}`;
  if (minAmount > 0) url += `&min_amount=${minAmount}`;
  if (bankFilter && bankFilter !== "ALL") url += `&bank_filter=${encodeURIComponent(bankFilter)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch mules");
  return res.json();
}

export async function fetchBankNotices(victimAccount, firNumber = "FIR-0142/2026/CYBER-INDORE") {
  const res = await fetch(`${API_BASE}/legal/notices/${victimAccount}?fir_number=${encodeURIComponent(firNumber)}`);
  if (!res.ok) throw new Error("Failed to fetch legal notices");
  return res.json();
}

export async function fetchCaseDiary(victimAccount, firNumber = "FIR-0142/2026/CYBER-INDORE") {
  const res = await fetch(`${API_BASE}/legal/case-diary/${victimAccount}?fir_number=${encodeURIComponent(firNumber)}`);
  if (!res.ok) throw new Error("Failed to fetch case diary");
  return res.json();
}

export async function runJuryBenchmark() {
  const res = await fetch(`${API_BASE}/jury/blind-test`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to run jury blind test");
  return res.json();
}

export async function uploadBankStatement(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error("Failed to upload and parse bank statement");
  return res.json();
}

export async function run60sFraudBenchmark() {
  const res = await fetch(`${API_BASE}/scanner/run-60s-benchmark`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to execute 60-second 2M fraud scan benchmark");
  return res.json();
}

export async function fetchProblematicTransactions(limit = 100, filterType = null, minAmount = 0, bankFilter = null, keyword = null) {
  let url = `${API_BASE}/scanner/problematic-transactions?limit=${limit}`;
  if (filterType) url += `&filter_type=${encodeURIComponent(filterType)}`;
  if (minAmount > 0) url += `&min_amount=${minAmount}`;
  if (bankFilter && bankFilter !== "ALL") url += `&bank_filter=${encodeURIComponent(bankFilter)}`;
  if (keyword && String(keyword).trim()) url += `&keyword=${encodeURIComponent(String(keyword).trim())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch problematic transactions");
  return res.json();
}

export async function executeEmergencyFreeze(accountIds) {
  const res = await fetch(`${API_BASE}/scanner/emergency-freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_ids: accountIds })
  });
  if (!res.ok) throw new Error("Failed to execute emergency multi-bank freeze");
  return res.json();
}

export async function fetchHamiHopping(victimAccount, maxHops = 4, timeWindow = 180) {
  const res = await fetch(`${API_BASE}/hami/hopping/${victimAccount}?max_hops=${maxHops}&time_window=${timeWindow}`);
  if (!res.ok) throw new Error("Failed to fetch HAMI AML hopping analysis");
  return res.json();
}

export async function fetchHamiClusters(limit = 30) {
  const res = await fetch(`${API_BASE}/hami/clusters?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch HAMI hopping clusters");
  return res.json();
}

export async function ingestFromUrl(url) {
  const res = await fetch(`${API_BASE}/ingest-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to ingest dataset from URL");
  }
  return res.json();
}

export async function fetchDetectedVictims() {
  const res = await fetch(`${API_BASE}/detected-victims`);
  if (!res.ok) throw new Error("Failed to fetch detected victims");
  return res.json();
}

export async function fetchEntities(limit = 500, bankFilter = null, minAmount = 0) {
  let url = `${API_BASE}/entities?limit=${limit}`;
  if (bankFilter && bankFilter !== "ALL") url += `&bank_filter=${encodeURIComponent(bankFilter)}`;
  if (minAmount > 0) url += `&min_amount=${minAmount}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch entity directory");
  return res.json();
}
