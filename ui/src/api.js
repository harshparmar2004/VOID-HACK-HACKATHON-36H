import { API_BASE } from "./config";

const TIMING_HEADER = "X-Process-Time-Ms";

// Every call goes through here. A failed call throws; no caller substitutes sample data.
async function send(path, options) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, options);
  } catch (err) {
    throw new Error(`Cannot reach the API at ${API_BASE} (${err.message})`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.detail || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return { body: await res.json(), serverMs: serverTime(res) };
}

// Time the API spent on the request, from its X-Process-Time-Ms header. Null if absent.
function serverTime(res) {
  const value = Number(res.headers.get(TIMING_HEADER));
  return res.headers.has(TIMING_HEADER) && Number.isFinite(value) ? value : null;
}

async function request(path, options) {
  return (await send(path, options)).body;
}

function query(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") q.set(key, value);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

const bank = (code) => (code && code !== "ALL" ? code : null);
const positive = (n) => (Number(n) > 0 ? Number(n) : null);
const keyword = (k) => (k && String(k).trim() ? String(k).trim() : null);

export function fetchSystemStatus() {
  return request("/status");
}

export function fetchVictims() {
  return request("/victims");
}

export function fetchActiveProfile() {
  return request("/profiles/active");
}

// Display filters only: they trim the returned graph, never the trace itself.
// Resolves to { data, serverMs }.
export async function traceVictim(victimAccount, { maxHops, minAmount, bankFilter, narrationKeyword } = {}) {
  const { body, serverMs } = await send(`/trace/${encodeURIComponent(victimAccount)}${query({
    max_hops: positive(maxHops),
    min_amount: positive(minAmount),
    bank_filter: bank(bankFilter),
    keyword: keyword(narrationKeyword)
  })}`);
  return { data: body, serverMs };
}

export function fetchMules({ limit, role, minRisk, minAmount, bankFilter } = {}) {
  return request(`/mules${query({
    limit,
    role_filter: role,
    min_risk: positive(minRisk),
    min_amount: positive(minAmount),
    bank_filter: bank(bankFilter)
  })}`);
}

export function fetchEntities({ limit, bankFilter, minAmount } = {}) {
  return request(`/entities${query({ limit, bank_filter: bank(bankFilter), min_amount: positive(minAmount) })}`);
}

export function fetchScannerSummary() {
  return request("/scanner/summary");
}

export function runScannerBenchmark() {
  return request("/scanner/run-60s-benchmark", { method: "POST" });
}

export function fetchProblematicTransactions({ limit, filterType, minAmount, bankFilter, narrationKeyword } = {}) {
  return request(`/scanner/problematic-transactions${query({
    limit,
    filter_type: filterType && filterType !== "ALL" ? filterType : null,
    min_amount: positive(minAmount),
    bank_filter: bank(bankFilter),
    keyword: keyword(narrationKeyword)
  })}`);
}

export function runJuryBenchmark(n) {
  return request("/jury/blind-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(n ? { n } : {})
  });
}

export function getTemplateDownloadUrl(fileName) {
  return `${API_BASE}/templates/${encodeURIComponent(fileName)}`;
}
