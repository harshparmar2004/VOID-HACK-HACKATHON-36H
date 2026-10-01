import React, { useState } from "react";
import { ShieldCheck, Lock, Hash, FileCheck, CheckCircle2, Clock, UserCheck, Download, Search } from "lucide-react";

export default function EvidenceVaultView() {
  const [searchTerm, setSearchTerm] = useState("");

  const custodyEntries = [
    {
      id: "CUST-001",
      artifactName: "transactions_2m.parquet",
      category: "Core Banking Transaction Export",
      sha256: "7F89E8B2A91D3C4EF8B20198C8912A3409B1F56E784D12A9E3C5B8A1D2E4F6C8",
      timestamp: "2026-10-01 21:15:00 IST",
      ingestedBy: "IO Inspector Rajesh Sharma (Cyber Branch)",
      recordsCount: "2,000,000 Transactions",
      fileSize: "22.89 MB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 63 Bharatiya Sakshya Adhiniyam (BSA), 2023"
    },
    {
      id: "CUST-002",
      artifactName: "telecom_cdr_extract.csv",
      category: "Cellular Call Detail Records (CDR)",
      sha256: "A9C8EBD3B99EE628C104598B62817647788D069677C0B291A8E4C3D5F7A9B1C2",
      timestamp: "2026-10-01 21:28:12 IST",
      ingestedBy: "Nodal Cell Liaison Sub-Inspector V. Kulkarni",
      recordsCount: "1,470 Identified Mules",
      fileSize: "5.6 KB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 65B Indian Evidence Act / Sec. 63 BSA"
    },
    {
      id: "CUST-003",
      artifactName: "jio_ipdr_session_log.csv",
      category: "Internet Protocol Detail Records (IPDR)",
      sha256: "638788C5E93DAE91B9812A45FBA414BAFED0641467B92C3D8E1F5A7B9C3D5E7F",
      timestamp: "2026-10-01 21:35:45 IST",
      ingestedBy: "Forensic Analyst Ankit Mehta (Indore Cyber Cell)",
      recordsCount: "2,564 Foreign Proxy IP Sessions",
      fileSize: "4.4 KB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 63 BSA, 2023"
    },
    {
      id: "CUST-004",
      artifactName: "npci_upi_bank_statement.csv",
      category: "NPCI Central Switch Logs",
      sha256: "A1FC082673B0D1D89823C412DC7CEF80885088D943C92B1A8E5F7A9B3C5D7E1F",
      timestamp: "2026-10-01 21:42:10 IST",
      ingestedBy: "IO Inspector Rajesh Sharma (Cyber Branch)",
      recordsCount: "24,368 Banking Entities",
      fileSize: "7.3 KB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 63 BSA, 2023"
    },
    {
      id: "CUST-005",
      artifactName: "whatsapp_chat_export.txt",
      category: "Digital Arrest Fraud Transcript",
      sha256: "257005884D2C482A99B123C4188180C46012EADE67B92A4C5D7E1F9A8B3C5D7E",
      timestamp: "2026-10-01 22:05:00 IST",
      ingestedBy: "Sub-Inspector S. Chouhan",
      recordsCount: "12 Chat Threads",
      fileSize: "0.7 KB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 63 BSA, 2023"
    },
    {
      id: "CUST-006",
      artifactName: "sbi_support_apk_metadata.json",
      category: "Headless Emulation & Trojan Signature",
      sha256: "650CC151597D2CC398A1B2C49192F72F99E765FF67A81B2C4D5E7F9A1B3C5D7E",
      timestamp: "2026-10-01 22:18:30 IST",
      ingestedBy: "Digital Forensic Examiner T. Joshi",
      recordsCount: "2,564 Emulated User Agents",
      fileSize: "0.6 KB",
      integrity: "TAMPER-PROOF (CHAIN-LOCKED)",
      verifiedSection: "Sec. 63 BSA, 2023"
    }
  ];

  const filtered = custodyEntries.filter(
    (e) =>
      e.artifactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.sha256.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#059669]"></span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              Chained Custody & Integrity Vault
            </span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2623] mt-1">
            Forensic Evidence Vault (Sec. 63 BSA / Sec. 65B IEA)
          </h2>
          <p className="text-xs text-[#746D65] mt-1">
            Cryptographic chain-of-custody ledger. Every ingested dataset is SHA-256 hashed and timestamp-locked to ensure 100% judicial admissibility.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search SHA-256 Hash or File..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-72 bg-white border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
          />
          <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
        </div>
      </div>

      {/* Custody Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase text-[#9E968D]">TOTAL ARTIFACTS</div>
          <div className="text-2xl font-bold font-mono text-[#2C2623] mt-1">6 Files</div>
          <div className="text-xs text-[#059669] font-medium mt-0.5">All SHA-256 Validated</div>
        </div>
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase text-[#9E968D]">CHAIN INTEGRITY</div>
          <div className="text-2xl font-bold font-mono text-[#059669] mt-1">100%</div>
          <div className="text-xs text-[#059669] font-medium mt-0.5">Zero Tampering Detected</div>
        </div>
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase text-[#9E968D]">LEGAL CERTIFICATE</div>
          <div className="text-sm font-bold text-[#2C2623] mt-2 font-serif">Sec 63 BSA Compliant</div>
          <div className="text-[11px] text-[#746D65]">Judicial Court Admissible</div>
        </div>
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs">
          <div className="text-[10px] font-bold uppercase text-[#9E968D]">STORAGE ENCRYPTION</div>
          <div className="text-sm font-bold font-mono text-[#D96B27] mt-2">AES-256 / SHA-256</div>
          <div className="text-[11px] text-[#746D65]">Offline Local Vault</div>
        </div>
      </div>

      {/* Chained Custody Ledger Table */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex items-center justify-between">
          <h3 className="font-bold text-sm text-[#2C2623] font-serif">
            Digital Evidence Chain-of-Custody Log
          </h3>
          <span className="text-xs text-[#059669] font-mono font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Hash Signatures Verified
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#E8E2D5] text-[10px] font-bold uppercase tracking-wider text-[#746D65]">
                <th className="py-3 px-4">Artifact & Source</th>
                <th className="py-3 px-4">SHA-256 Cryptographic Hash</th>
                <th className="py-3 px-4">Intake Timestamp & Examiner</th>
                <th className="py-3 px-4">Records & Size</th>
                <th className="py-3 px-4 text-right">Statutory Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAE1]">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-[#FAF6EE] transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-[#2C2623] font-mono">{item.artifactName}</div>
                    <div className="text-[11px] text-[#746D65]">{item.category}</div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-[#746D65] max-w-xs break-all">
                    {item.sha256}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-mono text-[#2C2623] text-[11px]">{item.timestamp}</div>
                    <div className="text-[11px] text-[#9E968D]">{item.ingestedBy}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-[#2C2623]">{item.recordsCount}</div>
                    <div className="text-[11px] text-[#9E968D]">{item.fileSize}</div>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <span className="px-2.5 py-1 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669] font-bold text-[10px] font-mono">
                      {item.integrity}
                    </span>
                    <div className="text-[10px] text-[#9E968D] mt-1">{item.verifiedSection}</div>
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
