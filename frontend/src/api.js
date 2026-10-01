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

export async function traceVictim(victimAccount, maxHops = 4, timeWindow = 180) {
  const res = await fetch(`${API_BASE}/trace/${victimAccount}?max_hops=${maxHops}&time_window=${timeWindow}`);
  if (!res.ok) throw new Error("Failed to trace victim money trail");
  return res.json();
}

export async function fetchMules(limit = 100, role = null) {
  let url = `${API_BASE}/mules?limit=${limit}`;
  if (role) url += `&role_filter=${role}`;
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

export async function fetchProblematicTransactions(limit = 100, filterType = null) {
  let url = `${API_BASE}/scanner/problematic-transactions?limit=${limit}`;
  if (filterType) url += `&filter_type=${encodeURIComponent(filterType)}`;
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


