import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error in view:", this.props.name, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-8 text-center space-y-4 shadow-sm my-6 max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold font-serif text-[#2C2623]">
              View Render Notice ({this.props.name || "Forensic Feature"})
            </h3>
            <p className="text-xs text-[#746D65] mt-1 max-w-md mx-auto">
              An unexpected data formatting discrepancy occurred while rendering this feature. Other system features remain fully operational.
            </p>
            {this.state.error?.message && (
              <p className="text-[11px] font-mono text-[#DC2626] bg-[#FEF2F2] p-2 rounded-lg mt-2 inline-block max-w-md truncate">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-[#D96B27] hover:bg-[#C25B1C] text-white text-xs font-semibold rounded-xl shadow-sm transition-all cursor-pointer inline-flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Rendering</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
