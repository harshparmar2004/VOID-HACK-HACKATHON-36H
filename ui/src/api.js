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
    // Per-field validation messages (HTTP 422), when the API sends them.
    error.errors = Array.isArray(body?.errors) ? body.errors : [];
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

// Re-scores in memory with the given changes and returns the impact. Writes nothing.
export function previewProfile(changes) {
  return request("/profiles/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes })
  });
}

// Only the search fields the API whitelists.
export function searchTransactions({ minAmount, maxAmount, bank, paymentMode, device, foreignIp, narrationCategory, fromTs, toTs, limit } = {}) {
  return request(`/transactions/search${query({
    min_amount: minAmount,
    max_amount: maxAmount,
    bank: keyword(bank),
    payment_mode: keyword(paymentMode),
    device: keyword(device),
    foreign_ip: foreignIp,
    narration_category: keyword(narrationCategory),
    from_ts: fromTs,
    to_ts: toTs,
    limit
  })}`);
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

// --- Cases and legal documents (Step 8). Writes go to the case store only. ---

const JSON_POST = { method: "POST", headers: { "Content-Type": "application/json" } };
const SHA_HEADER = "X-Content-SHA256";
const casePath = (caseId) => `/cases/${encodeURIComponent(caseId)}`;

export function fetchCases() {
  return request("/cases");
}

export function fetchCase(caseId) {
  return request(casePath(caseId));
}

export function openCase({ victims, officer, firNumber, complainant }) {
  return request("/cases", {
    ...JSON_POST,
    body: JSON.stringify({
      victims,
      officer,
      fir_number: keyword(firNumber),
      complainant: keyword(complainant)
    })
  });
}

export function closeCase(caseId, { officer, note }) {
  return request(`${casePath(caseId)}/close`, { ...JSON_POST, body: JSON.stringify({ officer, note: keyword(note) }) });
}

// The stored page byte for byte, with the SHA-256 the API computed for it.
export async function fetchStoredPage(caseId, outputId) {
  let res;
  try {
    res = await fetch(`${API_BASE}${casePath(caseId)}/outputs/${encodeURIComponent(outputId)}`);
  } catch (err) {
    throw new Error(`Cannot reach the API at ${API_BASE} (${err.message})`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (HTTP ${res.status})`);
  }
  const bytes = await res.arrayBuffer();
  return {
    html: new TextDecoder("utf-8").decode(bytes),
    sha256: res.headers.get(SHA_HEADER),
    computed: await sha256Hex(bytes)
  };
}

// SHA-256 of the bytes as received, worked out in the browser. Null where the browser cannot.
async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateNotices(victim, caseId) {
  return request(`/legal/notices/${encodeURIComponent(victim)}${query({ case_id: caseId })}`);
}

export function generateDiary(victim, caseId) {
  return request(`/legal/case-diary/${encodeURIComponent(victim)}${query({ case_id: caseId })}`);
}

// Asks the local model; slow. `summary` is null unless the answer passed validation.
export function fetchDiarySummary(victim, caseId) {
  return request(`/legal/case-diary/${encodeURIComponent(victim)}/summary${query({ case_id: caseId })}`);
}
