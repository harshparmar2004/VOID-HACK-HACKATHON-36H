// Display helpers. A missing value is shown as a dash, never as a made-up number.
export const DASH = "—";

const missing = (v) => v === null || v === undefined || v === "" || Number.isNaN(v);

export function inr(value, digits = 2) {
  if (missing(value) || Number.isNaN(Number(value))) return DASH;
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits })}`;
}

export function num(value, digits = 0) {
  if (missing(value) || Number.isNaN(Number(value))) return DASH;
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function text(value) {
  return missing(value) ? DASH : String(value);
}

export function dateTime(value) {
  return missing(value) ? DASH : String(value).replace("T", " ").slice(0, 19);
}

export function csvCell(value) {
  return `"${missing(value) ? "" : String(value).replace(/"/g, '""')}"`;
}

export function downloadCsv(fileName, headers, rows) {
  const body = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
