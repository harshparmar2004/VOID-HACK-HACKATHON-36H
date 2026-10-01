import React from "react";
import { ShieldCheck, Eye, RefreshCw, Plus, FileText, CheckCircle2 } from "lucide-react";

export default function CaseIntakeView({
  victimAccount,
  victimName = "Sunil Kumar Verma",
  mobileNumber = "+91 9811000001",
  firNumber = "FIR-0142/2026/CYBER-INDORE",
  totalSiphoned,
  systemStatus,
  onTraceNow,
  onOpenRegisterModal
}) {
  const artifactSlots = [
    {
      slot: "Core Banking Transaction Export (DuckDB)",
      format: "2,000,000 records, 11 Columns (RBI/NPCI format)",
      file: "transactions_2m.parquet",
      records: "2,000,000 valid",
      hash: "7F89E8B2A91D3C4E...C8912A3409B1F56E",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "NPCI / Bank Statement Logs",
      format: "Multi-bank transaction streams (.csv, .xlsx)",
      file: "npci_upi_bank_statement.csv",
      records: "24,368 accounts",
      hash: "A1FC082673B0D1D8...DC7CEF80885088D9",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Internet Protocol Detail Records (IPDR)",
      format: "CGNAT public IP, source port, MSISDN session",
      file: "jio_ipdr_session_log.csv",
      records: "2,564 foreign IPs",
      hash: "638788C5E93DAE91...FBA414BAFED06414",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Telecom Call Data Records (CDR)",
      format: "Airtel, Jio, Vi formats (.csv, .xlsx, .tsv)",
      file: "telecom_cdr_extract.csv",
      records: "1,470 mules",
      hash: "A9C8EBD3B99EE628...62817647788D0696",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "WhatsApp / Messenger Chat Exports",
      format: "Digital arrest transcripts (.txt, .json)",
      file: "whatsapp_chat_export.txt",
      records: "12 chat sessions",
      hash: "257005884D2C482A...188180C46012EADE",
      status: "LOCKED & VERIFIED"
    },
    {
      slot: "Malicious APK Package / Script Metadata",
      format: "Direct Android APK binary / script telemetry",
      file: "sbi_support_apk_metadata.json",
      records: "2,564 scripts",
      hash: "650CC151597D2CC3...9192F72F99E765FF",
      status: "LOCKED & VERIFIED"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] tracking-tight">
            Case Evidence Intake
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Upload or inspect the 6 forensic artifact slots. Every file is SHA-256 hashed and locked in the chained custody log.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E2D5] text-[#2C2623] text-xs font-semibold hover:bg-[#F8F4EC] transition-colors shadow-2xs">
            <RefreshCw className="w-3.5 h-3.5 text-[#746D65]" />
            <span>Reload Active Demo Files</span>
          </button>
          <button
            onClick={onOpenRegisterModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register New FIR</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards matching screenshot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            COMPLAINANT / VICTIM
          </div>
          <div className="text-lg font-bold text-[#2C2623] mt-1 font-serif">
            {victimName}
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5">
            {mobileNumber}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            TOTAL LOSS REPORTED
          </div>
          <div className="text-lg font-bold text-[#DC2626] mt-1 font-mono">
            ₹{totalSiphoned ? totalSiphoned.toLocaleString('en-IN') : "14,78,894"}
          </div>
          <div className="text-xs text-[#746D65] mt-0.5">
            4 Rapid Mule Hops in 12 Mins
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            POLICE STATION / FIR
          </div>
          <div className="text-sm font-bold text-[#2C2623] mt-1 font-serif">
            Cyber Crime Police Station, Indore
          </div>
          <div className="text-xs text-[#746D65] font-mono mt-0.5">
            {firNumber}
          </div>
        </div>

        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
            EVIDENCE ARTIFACTS
          </div>
          <div className="text-lg font-bold text-[#059669] mt-1 font-mono">
            6 / 6
          </div>
          <div className="text-xs text-[#059669] font-medium mt-0.5 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            100% Validated & Correlated
          </div>
        </div>
      </div>

      {/* Digital Artifact Slots Table matching screenshot */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif">
              Digital Artifact Slots
            </h3>
            <p className="text-xs text-[#746D65]">
              Banking Core Logs, NPCI UPI Logs, IPDR Session Maps, Headless Telemetry
            </p>
          </div>
          <button
            onClick={onTraceNow}
            className="px-3.5 py-1.5 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold shadow-2xs cursor-pointer"
          >
            Launch Multi-Hop Trace →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E8E2D5] text-[#9E968D] text-[10px] font-bold uppercase tracking-wider bg-[#FDFBF7]">
                <th className="py-3 px-4">Artifact Slot</th>
                <th className="py-3 px-4">Source File</th>
                <th className="py-3 px-4">Records Parsed</th>
                <th className="py-3 px-4">SHA-256 File Fingerprint</th>
                <th className="py-3 px-4 text-right">Actions & Integrity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1]">
              {artifactSlots.map((slot, i) => (
                <tr key={i} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#2C2623]">{slot.slot}</div>
                    <div className="text-[11px] text-[#9E968D]">{slot.format}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#746D65]">
                    {slot.file}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-md bg-[#F3EDE2] text-[#2C2623] font-medium font-mono text-[11px]">
                      {slot.records}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-[#9E968D]">
                    {slot.hash}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] font-bold text-[10px] tracking-wide">
                        {slot.status}
                      </span>
                      <button className="flex items-center gap-1 text-[11px] text-[#746D65] hover:text-[#2C2623] font-medium px-2 py-1 rounded bg-[#F8F4EC]">
                        <Eye className="w-3 h-3" />
                        <span>View</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
