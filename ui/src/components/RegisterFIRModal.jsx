import React, { useState } from "react";
import {
  X,
  ShieldAlert,
  ArrowRight,
  Zap,
  Building2,
  User,
  Phone,
  CreditCard,
  Calendar,
  AlertTriangle,
  AtSign,
  FileText,
  BadgeCheck
} from "lucide-react";

export default function RegisterFIRModal({ isOpen, onClose, onRegisterCase }) {
  const [formData, setFormData] = useState({
    victimName: "Sunil Kumar Verma",
    mobile: "+91 9811000001",
    accountNumber: "PUNB10000001",
    bankName: "Punjab National Bank",
    ifsc: "PUNB0001001",
    upiId: "sunil.verma@okpnb",
    amount: "370415.81",
    modusOperandi: "DIGITAL_ARREST",
    incidentDate: "2026-09-22T01:20",
    firNumber: "FIR-0142/2026/CYBER-INDORE"
  });

  if (!isOpen) return null;

  const handlePreFill = (preset) => {
    if (preset === "case1") {
      setFormData({
        victimName: "Sunil Kumar Verma",
        mobile: "+91 9811000001",
        accountNumber: "PUNB10000001",
        bankName: "Punjab National Bank",
        ifsc: "PUNB0001001",
        upiId: "sunil.verma@okpnb",
        amount: "370415.81",
        modusOperandi: "DIGITAL_ARREST",
        incidentDate: "2026-09-22T01:20",
        firNumber: "FIR-0142/2026/CYBER-INDORE"
      });
    } else if (preset === "case2") {
      setFormData({
        victimName: "Priya Sharma",
        mobile: "+91 9822334455",
        accountNumber: "BARB10000610",
        bankName: "Bank of Baroda",
        ifsc: "BARB0001610",
        upiId: "priya.sharma@okbob",
        amount: "163532.28",
        modusOperandi: "FAKE_TASK",
        incidentDate: "2026-09-26T10:57",
        firNumber: "FIR-0143/2026/CYBER-INDORE"
      });
    } else if (preset === "case3") {
      setFormData({
        victimName: "Ramesh Patel",
        mobile: "+91 9988776655",
        accountNumber: "AXIS10001045",
        bankName: "Axis Bank",
        ifsc: "AXIS0002045",
        upiId: "ramesh.patel@okaxis",
        amount: "144911.95",
        modusOperandi: "CRYPTO_P2P",
        incidentDate: "2026-09-26T11:02",
        firNumber: "FIR-0144/2026/CYBER-INDORE"
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.accountNumber.trim()) {
      alert("Please enter the victim bank account number.");
      return;
    }
    onRegisterCase(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-[#2C2623]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-[#E8E2D5] rounded-xl max-w-2xl sm:max-w-3xl w-full shadow-2xl overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#D96B27]"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                1930 Cyber Helpline & Station Diary Intake
              </span>
            </div>
            <h2 className="text-xl font-serif font-bold text-[#2C2623] mt-1 tracking-tight">
              Register New Financial Cyberfraud FIR & Victim Intake
            </h2>
            <p className="text-xs text-[#7C746D] mt-0.5">
              Establish the complainant origin anchor to initialize multi-hop smurfing trail tracing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md bg-white border border-[#E8E2D5] flex items-center justify-center text-[#746D65] hover:text-[#2C2623] hover:bg-[#F3EDE2] transition-colors cursor-pointer shrink-0"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Demo Pre-fill Pills */}
        <div className="px-6 py-2.5 bg-[#FAF6EE]/50 border-b border-[#E8E2D5] flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[11px] font-mono font-bold text-[#7C746D] flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-[#D96B27]" />
            <span>Quick Demo Intake:</span>
          </span>
          <button
            type="button"
            onClick={() => handlePreFill("case1")}
            className="px-2.5 py-1 rounded-md bg-white border border-[#E8E2D5] hover:border-[#D96B27] text-[#D96B27] hover:bg-[#FFF8F2] text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
          >
            Sunil Verma (₹3.70L • PNB • Digital Arrest)
          </button>
          <button
            type="button"
            onClick={() => handlePreFill("case2")}
            className="px-2.5 py-1 rounded-md bg-white border border-[#E8E2D5] hover:border-[#059669] text-[#059669] hover:bg-[#F0FDF4] text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
          >
            Priya Sharma (₹1.63L • BOB • Telegram Task)
          </button>
          <button
            type="button"
            onClick={() => handlePreFill("case3")}
            className="px-2.5 py-1 rounded-md bg-white border border-[#E8E2D5] hover:border-[#7C3AED] text-[#7C3AED] hover:bg-[#FAF5FF] text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
          >
            Ramesh Patel (₹1.44L • Axis • Crypto Ponzi)
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Complainant Details */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[10px] font-bold font-mono text-[#746D65]">
                1
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                Complainant / Citizen Identity
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Victim Full Name <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.victimName}
                    onChange={(e) => setFormData({ ...formData, victimName: e.target.value })}
                    className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3.5 py-2 text-xs font-medium text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors"
                    placeholder="e.g. Sunil Kumar Verma"
                  />
                  <User className="w-4 h-4 absolute right-3 top-3 text-[#9E968D] pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Registered Mobile Number <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3.5 py-2 text-xs font-mono text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors"
                    placeholder="+91 9811000001"
                  />
                  <Phone className="w-4 h-4 absolute right-3 top-3 text-[#9E968D] pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Victim Bank & Account Coordinates */}
          <div className="space-y-3 pt-2 border-t border-[#F0EBE0]">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[10px] font-bold font-mono text-[#746D65]">
                2
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                Victim Bank Coordinates (Trail Origin Account)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  12-Digit Account Number <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                    className="w-full h-10 bg-white border-2 border-[#D96B27] rounded-md px-3.5 py-2 text-xs font-mono font-bold text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:ring-2 focus:ring-[#D96B27]/20 transition-all"
                    placeholder="100000000001"
                  />
                  <CreditCard className="w-4 h-4 absolute right-3 top-3 text-[#D96B27] pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Bank Name <span className="text-[#DC2626]">*</span>
                </label>
                <select
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3 py-2 text-xs font-medium text-[#2C2623] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors cursor-pointer"
                >
                  <option value="Punjab National Bank">Punjab National Bank</option>
                  <option value="HDFC Bank">HDFC Bank</option>
                  <option value="State Bank of India">State Bank of India</option>
                  <option value="ICICI Bank">ICICI Bank</option>
                  <option value="Axis Bank">Axis Bank</option>
                  <option value="Bank of Baroda">Bank of Baroda</option>
                  <option value="Union Bank of India">Union Bank of India</option>
                  <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  IFSC Code <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.ifsc}
                  onChange={(e) => setFormData({ ...formData, ifsc: e.target.value.toUpperCase() })}
                  className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3.5 py-2 text-xs font-mono font-bold text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors uppercase"
                  placeholder="PUNB0000001"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Victim UPI ID / VPA Handle
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.upiId}
                    onChange={(e) => setFormData({ ...formData, upiId: e.target.value })}
                    className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3.5 py-2 text-xs font-mono text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors"
                    placeholder="sunil.verma@okpnb"
                  />
                  <AtSign className="w-4 h-4 absolute right-3 top-3 text-[#9E968D] pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Total Stolen Amount Reported (₹) <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md pl-3.5 pr-14 py-2 text-xs font-mono font-bold text-[#DC2626] placeholder-[#9E968D] focus:outline-none focus:border-[#DC2626] focus:ring-1 focus:ring-[#DC2626]/30 transition-colors"
                    placeholder="370415.81"
                  />
                  <span className="absolute right-3 top-2.5 px-1.5 py-0.5 rounded-sm bg-[#FEF2F2] border border-[#FCA5A5] text-[10px] font-mono font-bold text-[#DC2626]">
                    INR
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Modus Operandi & Police FIR Details */}
          <div className="space-y-3 pt-2 border-t border-[#F0EBE0]">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-[#FAF6EE] border border-[#E8E2D5] flex items-center justify-center text-[10px] font-bold font-mono text-[#746D65]">
                3
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#746D65] font-mono">
                Crime Incident & Statutory Police Record
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Fraud Modus Operandi <span className="text-[#DC2626]">*</span>
                </label>
                <select
                  value={formData.modusOperandi}
                  onChange={(e) => setFormData({ ...formData, modusOperandi: e.target.value })}
                  className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3 py-2 text-xs font-medium text-[#2C2623] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors cursor-pointer"
                >
                  <option value="DIGITAL_ARREST">Digital Arrest (CBI/Police Impersonation)</option>
                  <option value="FAKE_TASK">Telegram Fake Task / YouTube Rating</option>
                  <option value="PONZI_BOT">Crypto / Stock Trading Ponzi Bot</option>
                  <option value="LOAN_APP">Instant Loan App Blackmail</option>
                  <option value="OTP_PHISHING">SIM Swap / APK Phishing</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Incident Date & Time <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.incidentDate}
                  onChange={(e) => setFormData({ ...formData, incidentDate: e.target.value })}
                  className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2C2623] uppercase tracking-wider block mb-1.5">
                  Assigned FIR Number <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.firNumber}
                    onChange={(e) => setFormData({ ...formData, firNumber: e.target.value })}
                    className="w-full h-10 bg-white border border-[#D4CEBF] rounded-md px-3.5 py-2 text-xs font-mono font-bold text-[#2C2623] placeholder-[#9E968D] focus:outline-none focus:border-[#D96B27] focus:ring-1 focus:ring-[#D96B27]/30 transition-colors"
                    placeholder="FIR-0142/2026/CYBER-INDORE"
                  />
                  <FileText className="w-4 h-4 absolute right-3 top-3 text-[#9E968D] pointer-events-none" />
                </div>
              </div>
            </div>
          </div>


          {/* Action Footer */}
          <div className="pt-4 border-t border-[#E8E2D5] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-5 rounded-md bg-white border border-[#D4CEBF] hover:border-[#2C2623] text-xs font-semibold text-[#746D65] hover:text-[#2C2623] hover:bg-[#FAF6EE] transition-colors cursor-pointer shadow-2xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-10 flex items-center gap-2 px-6 rounded-md bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold transition-all shadow-xs hover:shadow cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>Register Complaint &amp; Trace All 4 Layers (L1 → L2 → L3 → L4)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
