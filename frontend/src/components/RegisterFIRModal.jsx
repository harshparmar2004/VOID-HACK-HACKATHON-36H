import React, { useState } from "react";
import { X, ShieldAlert, ArrowRight, Zap, Building2, User, Phone, CreditCard, DollarSign, Calendar, AlertTriangle } from "lucide-react";

export default function RegisterFIRModal({ isOpen, onClose, onRegisterCase }) {
  const [formData, setFormData] = useState({
    victimName: "Sunil Kumar Verma",
    mobile: "+91 9811000001",
    accountNumber: "100000000001",
    bankName: "HDFC Bank",
    ifsc: "HDFC0000250",
    upiId: "sunilverma@okhdfcbank",
    amount: "1478894",
    modusOperandi: "DIGITAL_ARREST",
    incidentDate: "2026-10-13T00:04",
    firNumber: "FIR-0142/2026/CYBER-INDORE"
  });

  if (!isOpen) return null;

  const handlePreFill = (preset) => {
    if (preset === "case1") {
      setFormData({
        victimName: "Sunil Kumar Verma",
        mobile: "+91 9811000001",
        accountNumber: "100000000001",
        bankName: "HDFC Bank",
        ifsc: "HDFC0000250",
        upiId: "sunilverma@okhdfcbank",
        amount: "1478894",
        modusOperandi: "DIGITAL_ARREST",
        incidentDate: "2026-10-13T00:04",
        firNumber: "FIR-0142/2026/CYBER-INDORE"
      });
    } else if (preset === "case2") {
      setFormData({
        victimName: "Priya Sharma",
        mobile: "+91 9822334455",
        accountNumber: "100000000002",
        bankName: "State Bank of India",
        ifsc: "SBIN0001420",
        upiId: "priya.sharma@oksbi",
        amount: "890000",
        modusOperandi: "FAKE_TASK",
        incidentDate: "2026-10-12T14:30",
        firNumber: "FIR-0143/2026/CYBER-INDORE"
      });
    } else if (preset === "case3") {
      setFormData({
        victimName: "Ramesh Patel",
        mobile: "+91 9988776655",
        accountNumber: "100000000003",
        bankName: "ICICI Bank",
        ifsc: "ICIC0008912",
        upiId: "ramesh.patel@icici",
        amount: "1125000",
        modusOperandi: "PONZI_BOT",
        incidentDate: "2026-10-11T18:15",
        firNumber: "FIR-0144/2026/CYBER-INDORE"
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.accountNumber.trim()) {
      alert("Please enter the 12-digit victim bank account number.");
      return;
    }
    onRegisterCase(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-[#E8E2D5] rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#FAF6EE] border-b border-[#E8E2D5] p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#D96B27]"></span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                1930 Cyber Helpline & Station Diary Intake
              </span>
            </div>
            <h2 className="text-xl font-serif font-bold text-[#2C2623] mt-1">
              Register New Financial Cyberfraud FIR & Victim Intake
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-[#E8E2D5] flex items-center justify-center text-[#746D65] hover:text-[#2C2623] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Demo Pre-fill Pills */}
        <div className="px-6 pt-4 pb-2 bg-[#FDFBF7] border-b border-[#F0EAE1] flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono font-bold text-[#9E968D]">⚡ Quick Demo Intake:</span>
          <button
            type="button"
            onClick={() => handlePreFill("case1")}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] text-[#D96B27] hover:bg-[#FAF6EE] text-[11px] font-semibold transition-colors cursor-pointer"
          >
            Sunil Verma (₹14.7L • Digital Arrest)
          </button>
          <button
            type="button"
            onClick={() => handlePreFill("case2")}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] text-[#059669] hover:bg-[#FAF6EE] text-[11px] font-semibold transition-colors cursor-pointer"
          >
            Priya Sharma (₹8.9L • Telegram Task)
          </button>
          <button
            type="button"
            onClick={() => handlePreFill("case3")}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] text-[#7C3AED] hover:bg-[#FAF6EE] text-[11px] font-semibold transition-colors cursor-pointer"
          >
            Ramesh Patel (₹11.2L • Crypto Ponzi)
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Complainant Details */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono mb-2">
              1. COMPLAINANT / CITIZEN IDENTITY
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Victim Full Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.victimName}
                    onChange={(e) => setFormData({ ...formData, victimName: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-medium text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                    placeholder="e.g. Sunil Kumar Verma"
                  />
                  <User className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Registered Mobile Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#D96B27]"
                    placeholder="+91 9811000001"
                  />
                  <Phone className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#9E968D]" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Victim Bank & Account Coordinates */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono mb-2">
              2. VICTIM BANK ACCOUNT COORDINATES (TRAIL ORIGIN)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  12-Digit Bank Account Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                    className="w-full bg-[#FAF6EE] border-2 border-[#D96B27] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#2C2623] focus:outline-none"
                    placeholder="100000000001"
                  />
                  <CreditCard className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#D96B27]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Bank Name
                </label>
                <select
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-medium text-[#2C2623] focus:outline-none"
                >
                  <option value="HDFC Bank">HDFC Bank</option>
                  <option value="State Bank of India">State Bank of India</option>
                  <option value="ICICI Bank">ICICI Bank</option>
                  <option value="Axis Bank">Axis Bank</option>
                  <option value="Punjab National Bank">Punjab National Bank</option>
                  <option value="Union Bank of India">Union Bank of India</option>
                  <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  IFSC Code
                </label>
                <input
                  type="text"
                  required
                  value={formData.ifsc}
                  onChange={(e) => setFormData({ ...formData, ifsc: e.target.value.toUpperCase() })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#2C2623] focus:outline-none uppercase"
                  placeholder="HDFC0000250"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Victim UPI ID / VPA
                </label>
                <input
                  type="text"
                  value={formData.upiId}
                  onChange={(e) => setFormData({ ...formData, upiId: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none"
                  placeholder="name@okhdfcbank"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Total Stolen Amount Reported (₹)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#DC2626] focus:outline-none"
                    placeholder="1478894"
                  />
                  <DollarSign className="w-3.5 h-3.5 absolute right-3 top-2.5 text-[#DC2626]" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Modus Operandi & Police FIR Details */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono mb-2">
              3. CRIME INCIDENT & STATUTORY RECORD
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Fraud Modus Operandi
                </label>
                <select
                  value={formData.modusOperandi}
                  onChange={(e) => setFormData({ ...formData, modusOperandi: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-medium text-[#2C2623] focus:outline-none"
                >
                  <option value="DIGITAL_ARREST">Digital Arrest (CBI/Police Impersonation)</option>
                  <option value="FAKE_TASK">Telegram Fake Task / YouTube Rating</option>
                  <option value="PONZI_BOT">Crypto / Stock Trading Ponzi Bot</option>
                  <option value="LOAN_APP">Instant Loan App Blackmail</option>
                  <option value="OTP_PHISHING">SIM Swap / APK Phishing</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Incident Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={formData.incidentDate}
                  onChange={(e) => setFormData({ ...formData, incidentDate: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#2C2623] block mb-1">
                  Assigned FIR Number
                </label>
                <input
                  type="text"
                  required
                  value={formData.firNumber}
                  onChange={(e) => setFormData({ ...formData, firNumber: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#2C2623] focus:outline-none"
                  placeholder="FIR-0142/2026/CYBER-INDORE"
                />
              </div>
            </div>
          </div>

          {/* Golden Hour Alert Banner */}
          <div className="bg-[#FFF4EC] border-l-4 border-[#D96B27] p-3 rounded-r-xl text-xs space-y-1">
            <div className="font-bold text-[#D96B27] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 fill-[#D96B27]" />
              <span>Automated 4-Layer Forensic Dispatch</span>
            </div>
            <p className="text-[#746D65] text-[11px]">
              Submitting this intake form immediately parses the 2,000,000 transactions database, identifies Layer 1 (Collector), correlates Layer 2 (50 Distributor Mules), detects Layer 3 & 4 (Terminal Cash-outs), and generates court-ready Section 91 freeze notices.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-[#E8E2D5] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5] text-xs font-semibold text-[#746D65] hover:text-[#2C2623] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-bold shadow-md transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Register Complaint & Trace All 4 Layers (L1 → L2 → L3 → L4)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
