import React, { useState, useEffect } from "react";
import {
  Network,
  GitBranch,
  Layers,
  Repeat,
  ShieldAlert,
  Zap,
  Search,
  Copy,
  Check,
  ExternalLink,
  Cpu,
  ArrowRight,
  Shield,
  Activity,
  AlertTriangle,
  RefreshCw,
  Clock,
  TrendingDown
} from "lucide-react";
import { fetchHamiHopping, fetchHamiClusters } from "../api";

const BENCHMARK_SUGGESTIONS = [
  { account: "KKBK10000000", label: "Originating Victim", desc: "12-node smurfing dispersal" },
  { account: "HDFC10000336", label: "Anchor Hub Mule", desc: "73 nodes, multi-tier scatter-gather" },
  { account: "SBIN10000401", label: "High Fan-Out", desc: "26 fan-out cashouts" },
  { account: "BARB10000600", label: "Consolidation Funnel", desc: "Fan-in aggregation" },
  { account: "PYTM10000327", label: "Fintech Fast Transit", desc: "Instant velocity pass-through" }
];

export default function HamiHoppingView({ victimAccount, onSelectVictim, onNavigateTab }) {
  const [selectedAccount, setSelectedAccount] = useState(victimAccount || "KKBK10000000");
  const [searchInput, setSearchInput] = useState(victimAccount || "KKBK10000000");
  const [hoppingData, setHoppingData] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activePatternFilter, setActivePatternFilter] = useState("ALL");
  const [copiedId, setCopiedId] = useState(null);
  const [selectedHop, setSelectedHop] = useState(null);

  useEffect(() => {
    if (victimAccount && victimAccount !== selectedAccount) {
      setSelectedAccount(victimAccount);
      setSearchInput(victimAccount);
    }
  }, [victimAccount]);

  useEffect(() => {
    loadHoppingAnalysis(selectedAccount);
    loadGlobalClusters();
  }, [selectedAccount]);

  const loadHoppingAnalysis = async (acc) => {
    if (!acc) return;
    setLoading(true);
    try {
      const data = await fetchHamiHopping(acc);
      setHoppingData(data);
      // Auto-select Hop 1 if available
      if (data?.hop_pipeline && data.hop_pipeline.length > 0) {
        setSelectedHop(data.hop_pipeline[0].hop_number);
      } else {
        setSelectedHop(null);
      }
    } catch (err) {
      console.warn("Failed to load HAMI hopping data:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadGlobalClusters = async () => {
    try {
      const clusterList = await fetchHamiClusters(30);
      if (Array.isArray(clusterList)) {
        setClusters(clusterList);
      }
    } catch (err) {
      console.warn("Failed to load HAMI clusters:", err);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSelectedAccount(searchInput.trim());
      if (onSelectVictim) onSelectVictim(searchInput.trim());
    }
  };

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const inspectAccount = (acc) => {
    if (!acc) return;
    setSelectedAccount(acc);
    setSearchInput(acc);
    if (onSelectVictim) onSelectVictim(acc);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const getPatternBadge = (pattern) => {
    switch (pattern) {
      case "Scatter-Gather":
        return {
          bg: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/30",
          icon: Layers,
          label: "Scatter-Gather (Bunny Hopping)",
          desc: "Multi-hop dispersion followed by intermediate reconsolidation"
        };
      case "Fan-Out":
        return {
          bg: "bg-[#D96B27]/10 text-[#D96B27] border-[#D96B27]/30",
          icon: GitBranch,
          label: "Fan-Out (Smurfing Dispersal)",
          desc: "Single account rapidly splitting funds into many downstream mules"
        };
      case "Fan-In":
        return {
          bg: "bg-[#0284C7]/10 text-[#0284C7] border-[#0284C7]/30",
          icon: TrendingDown,
          label: "Fan-In (Consolidation)",
          desc: "Multiple remitter accounts funneling capital into one collector hub"
        };
      case "Cycle":
        return {
          bg: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/30",
          icon: Repeat,
          label: "Cycle (Circular Laundering)",
          desc: "Closed-loop round tripping to obfuscate source of stolen funds"
        };
      case "Gather-Scatter":
        return {
          bg: "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/30",
          icon: Activity,
          label: "Gather-Scatter (Hub Pooling)",
          desc: "Rapid pool aggregation followed by instant multi-rail fan-out"
        };
      case "Rapid Pass-Through":
        return {
          bg: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
          icon: Zap,
          label: "Rapid Pass-Through (Transit Drain)",
          desc: "Near-instantaneous fund drainage within short velocity window"
        };
      default:
        return {
          bg: "bg-[#57534E]/10 text-[#57534E] border-[#57534E]/30",
          icon: Network,
          label: pattern || "Linear Multi-Hop",
          desc: "Sequential transfer chain"
        };
    }
  };

  const currentPattern = getPatternBadge(hoppingData?.topological_pattern);
  const PatternIcon = currentPattern.icon;

  const filteredClusters = clusters.filter((c) => {
    if (activePatternFilter === "ALL") return true;
    return c.hami_pattern.toLowerCase().includes(activePatternFilter.toLowerCase());
  });

  const selectedHopData = hoppingData?.hop_pipeline?.find((h) => h.hop_number === selectedHop);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED] animate-pulse"></span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                Topological GNN Analytics • Hugging Face Integration
              </span>
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#2C2623] flex items-center gap-2">
              HAMI AML Detector — Multi-Hop Hopping Engine
              <span className="text-xs font-mono font-normal bg-[#FAF6EE] text-[#7C3AED] border border-[#E8E2D5] px-2.5 py-0.5 rounded-full">
                Ymak7/HAMI-AML-DETECTOR
              </span>
            </h2>
            <p className="text-xs text-[#746D65] max-w-3xl leading-relaxed">
              Dynamically maps transaction hopping paths across 2M records, executes pure PyTorch multi-head 
              <strong> Graph Attention Networks (GAT)</strong>, and classifies complex multi-tier laundering 
              topologies: <em>Fan-Out Smurfing</em>, <em>Fan-In Consolidation</em>, <em>Scatter-Gather Bunny Hopping</em>, and <em>Circular Cycles</em>.
            </p>
          </div>

          {/* Account Search & Benchmark Shortcuts */}
          <div className="space-y-2">
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Enter victim or mule account..."
                  className="w-64 bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-3 py-2 text-xs font-mono text-[#2C2623] focus:outline-none focus:border-[#7C3AED]"
                />
                <Search className="w-3.5 h-3.5 text-[#9E968D] absolute right-3 top-2.5" />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="bg-[#2C2623] hover:bg-[#443E3A] text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5 text-[#D96B27]" />}
                <span>Inspect Hopping</span>
              </button>
            </form>

            {/* Quick Benchmark Pills */}
            <div className="flex items-center gap-1 text-[10px] font-mono text-[#9E968D] justify-end">
              <span>Benchmarks:</span>
              {["KKBK10000000", "HDFC10000336", "SBIN10000401", "BARB10000600"].map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => inspectAccount(acc)}
                  className={`px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    selectedAccount === acc
                      ? "bg-[#7C3AED] text-white border-[#7C3AED] font-bold"
                      : "bg-[#FAF6EE] text-[#746D65] border-[#E8E2D5] hover:border-[#7C3AED]"
                  }`}
                  title={`Inspect ${acc}`}
                >
                  {acc.slice(0, 4)}..{acc.slice(-4)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Feature Badges */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#F0EAE1] text-[11px] font-mono text-[#746D65]">
          <span className="bg-[#FAF6EE] border border-[#E8E2D5] px-2.5 py-1 rounded-lg flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-[#7C3AED]" />
            <span>Multi-Hop Bunny Hopping</span>
          </span>
          <span className="bg-[#FAF6EE] border border-[#E8E2D5] px-2.5 py-1 rounded-lg flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-[#D96B27]" />
            <span>PyTorch Multi-Head GAT</span>
          </span>
          <span className="bg-[#FAF6EE] border border-[#E8E2D5] px-2.5 py-1 rounded-lg flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-[#059669]" />
            <span>SHA-256 Cluster Fingerprint</span>
          </span>
          <span className="bg-[#FAF6EE] border border-[#E8E2D5] px-2.5 py-1 rounded-lg flex items-center gap-1.5">
            <Repeat className="w-3 h-3 text-[#DC2626]" />
            <span>Circular Cycle Detection</span>
          </span>
        </div>
      </div>

      {/* Unknown Account Empty State Banner */}
      {hoppingData && hoppingData.found === false && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-[#92400E]">
            <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0" />
            <h3 className="font-serif font-bold text-sm">Account Not Found in 2,000,000 Dataset</h3>
          </div>
          <p className="text-xs text-[#B45309] leading-relaxed">
            Account <code className="font-mono font-bold bg-white/70 px-1.5 py-0.5 rounded border border-[#FDE68A]">{selectedAccount}</code> has no direct transaction inflows or outflows in the local DuckDB partition.
          </p>
          <div className="pt-2 border-t border-[#FDE68A]/60 flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-[#92400E]">Suggested Benchmark Accounts:</span>
            {BENCHMARK_SUGGESTIONS.map((b) => (
              <button
                key={b.account}
                onClick={() => inspectAccount(b.account)}
                className="px-2.5 py-1 rounded-lg text-xs font-mono bg-white text-[#92400E] border border-[#FDE68A] hover:bg-[#FEF3C7] transition-colors cursor-pointer"
              >
                <strong>{b.account}</strong> ({b.label})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Primary Pattern & KPI Scoreboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: HAMI Detected Pattern */}
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
              HAMI Primary Pattern
            </span>
            {hoppingData?.pattern_confidence && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#7C3AED]/15 text-[#7C3AED]">
                {hoppingData.pattern_confidence}% GAT
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl border ${currentPattern.bg}`}>
              <PatternIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-[#2C2623] font-serif">
                {hoppingData?.topological_pattern || "Detecting..."}
              </div>
              <div className="text-[10px] text-[#9E968D] font-mono">Topological Classification</div>
            </div>
          </div>
          <p className="text-[11px] text-[#746D65] leading-snug pt-1">
            {hoppingData?.evidence_bullets?.[0] || currentPattern.desc}
          </p>
        </div>

        {/* Card 2: Cluster SHA-256 Fingerprint */}
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            HAMI Cluster Fingerprint
          </div>
          <div className="font-mono text-xs text-[#2C2623] bg-[#FAF6EE] p-2.5 rounded-xl border border-[#F0EAE1] flex items-center justify-between">
            <span className="truncate max-w-[160px] font-bold">
              {hoppingData?.cluster_fingerprint ? `${hoppingData.cluster_fingerprint.slice(0, 16)}...` : "SHA256-PENDING"}
            </span>
            <button
              onClick={() => handleCopy(hoppingData?.cluster_fingerprint || "")}
              className="text-[#9E968D] hover:text-[#2C2623] cursor-pointer ml-1"
              title="Copy SHA-256 Fingerprint"
            >
              {copiedId === hoppingData?.cluster_fingerprint ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="text-[11px] text-[#746D65]">
            Cryptographic sub-graph identifier derived from canonical edge signatures
          </div>
        </div>

        {/* Card 3: Cycle & Fan-In / Fan-Out Metrics */}
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            Graph Connectivity
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2">
              <div className="text-lg font-bold font-serif text-[#D96B27]">
                {hoppingData?.max_out_degree || 0}
              </div>
              <div className="text-[10px] text-[#9E968D] font-mono">Max Fan-Out</div>
            </div>
            <div className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2">
              <div className="text-lg font-bold font-serif text-[#0284C7]">
                {hoppingData?.max_in_degree || 0}
              </div>
              <div className="text-[10px] text-[#9E968D] font-mono">Max Fan-In</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] pt-1 text-[#746D65]">
            <span>Cycle Detected:</span>
            {hoppingData?.has_cycle ? (
              <span className="font-bold text-[#DC2626] flex items-center gap-1 font-mono">
                <AlertTriangle className="w-3 h-3" /> YES (Looping)
              </span>
            ) : (
              <span className="font-bold text-green-600 font-mono">No Cycle</span>
            )}
          </div>
        </div>

        {/* Card 4: GNN Model Status */}
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
            PyTorch GAT Status
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#746D65]">GAT Attention Heads:</span>
              <span className="font-mono font-bold text-xs text-[#7C3AED]">3 Heads (ReLU + Softmax)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#746D65]">Traced Nodes:</span>
              <span className="font-mono font-bold text-xs text-[#2C2623]">{hoppingData?.total_nodes || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#746D65]">Traversed Edges:</span>
              <span className="font-mono font-bold text-xs text-[#2C2623]">{hoppingData?.total_edges || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#746D65]">Execution Time:</span>
              <span className="font-mono font-bold text-xs text-green-600">
                {hoppingData?.execution_time_ms ? `${hoppingData.execution_time_ms} ms` : "< 10 ms"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Forensic Evidence & PyTorch GAT Explainability Panel */}
      {hoppingData && hoppingData.found !== false && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Topological Evidence Drivers */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-sm text-[#2C2623] flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#D96B27]" />
                Topological AML Evidence & Laundering Indicators
              </h3>
              <span className="text-[10px] font-mono bg-[#FAF6EE] text-[#746D65] border border-[#E8E2D5] px-2 py-0.5 rounded-full">
                HAMI Engine
              </span>
            </div>
            <p className="text-xs text-[#746D65]">
              Signals extracted from 2M transaction graph traversal:
            </p>
            <div className="space-y-2">
              {hoppingData?.evidence_bullets && hoppingData.evidence_bullets.length > 0 ? (
                hoppingData.evidence_bullets.map((bullet, idx) => (
                  <div
                    key={idx}
                    className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2.5 text-xs text-[#2C2623] flex items-start gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#D96B27] mt-1.5 shrink-0" />
                    <span className="leading-relaxed">{bullet}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-[#9E968D]">Analyzing topology drivers...</div>
              )}
            </div>
            {hoppingData?.detailed_cycles && hoppingData.detailed_cycles.length > 0 && (
              <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-3 text-xs text-[#991B1B] space-y-1">
                <div className="font-bold font-serif flex items-center gap-1.5">
                  <Repeat className="w-3.5 h-3.5" />
                  Circular Round-Tripping Detected
                </div>
                <div className="font-mono text-[11px]">
                  Circulated Amount: ₹{hoppingData.detailed_cycles[0].circulated_amount_inr?.toLocaleString()} • 
                  Duration: {hoppingData.detailed_cycles[0].duration_minutes} min • 
                  Length: {hoppingData.detailed_cycles[0].length} hops
                </div>
              </div>
            )}
          </div>

          {/* Right: PyTorch 3-Head GAT Attention Weights */}
          <div className="bg-white border border-[#E8E2D5] rounded-2xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-sm text-[#2C2623] flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#7C3AED]" />
                PyTorch GAT Multi-Head Attention Weights
              </h3>
              <span className="text-[10px] font-mono bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20 px-2 py-0.5 rounded-full font-bold">
                Seed 42 • Deterministic
              </span>
            </div>
            <p className="text-xs text-[#746D65]">
              Neural attention heads specializing on topological laundering signatures:
            </p>

            {/* 3 Heads Breakdown */}
            <div className="space-y-2">
              <div className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2.5 space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-[#2C2623] font-bold">Head 1: Fan-Out Split & Smurfing</span>
                  <span className="text-[#7C3AED] font-bold">38% Weight</span>
                </div>
                <div className="w-full bg-[#E8E2D5] rounded-full h-1.5 overflow-hidden">
                  <div className="bg-[#7C3AED] h-full rounded-full" style={{ width: "38%" }}></div>
                </div>
              </div>
              <div className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2.5 space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-[#2C2623] font-bold">Head 2: Velocity & Pass-Through Drain</span>
                  <span className="text-[#D96B27] font-bold">34% Weight</span>
                </div>
                <div className="w-full bg-[#E8E2D5] rounded-full h-1.5 overflow-hidden">
                  <div className="bg-[#D96B27] h-full rounded-full" style={{ width: "34%" }}></div>
                </div>
              </div>
              <div className="bg-[#FAF6EE] border border-[#F0EAE1] rounded-xl p-2.5 space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-[#2C2623] font-bold">Head 3: Hub Aggregation & Circular Loops</span>
                  <span className="text-[#0284C7] font-bold">28% Weight</span>
                </div>
                <div className="w-full bg-[#E8E2D5] rounded-full h-1.5 overflow-hidden">
                  <div className="bg-[#0284C7] h-full rounded-full" style={{ width: "28%" }}></div>
                </div>
              </div>
            </div>

            {/* Top Attention Edges */}
            {hoppingData?.model_explanation?.top_attention_edges?.length > 0 && (
              <div className="pt-2 border-t border-[#F0EAE1] space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E968D] font-mono">
                  Top GAT Attention Edges (Ranked by α)
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                  {hoppingData.model_explanation.top_attention_edges.slice(0, 3).map((edge, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[11px] font-mono bg-[#FAF6EE] px-2.5 py-1.5 rounded-lg border border-[#F0EAE1]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#2C2623] font-bold">{edge.from}</span>
                        <ArrowRight className="w-3 h-3 text-[#9E968D]" />
                        <span className="text-[#7C3AED] font-bold">{edge.to}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#746D65]">₹{edge.amount?.toLocaleString()}</span>
                        <span className="bg-[#7C3AED]/10 text-[#7C3AED] px-1.5 py-0.5 rounded font-bold text-[10px]">
                          α = {edge.attention_weight}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cycle Alert Banner (if cycles found) */}
      {hoppingData?.has_cycle && (
        <div className="bg-[#FEF2F2] border border-[#F87171] rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
          <div className="space-y-1 flex-1">
            <div className="font-bold text-sm text-[#991B1B] font-serif">
              Circular Laundering Loop Discovered by HAMI Engine
            </div>
            <p className="text-xs text-[#7F1D1D] leading-relaxed">
              Funds in this network looped back into previously encountered accounts. Circular round-tripping 
              is a primary indicator of deliberate audit-trail obfuscation.
            </p>
            {hoppingData.cycles_detected?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {hoppingData.cycles_detected.map((cyc, idx) => (
                  <span
                    key={idx}
                    className="font-mono text-[11px] bg-white border border-[#FCA5A5] text-[#991B1B] px-2.5 py-1 rounded-lg"
                  >
                    Loop {idx + 1}: {cyc.join(" ➔ ")} ➔ {cyc[0]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Multi-Hop Hopping Transition Pipeline */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-serif font-bold text-base text-[#2C2623] flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[#7C3AED]" />
              Multi-Hop Layered Hopping Pipeline (Chronological Velocity)
            </h3>
            <p className="text-xs text-[#746D65] mt-0.5">
              Tracks money velocity from initial drain through smurfing distribution hops to terminal cashouts. Click any hop to inspect transfers.
            </p>
          </div>
          <div className="text-xs font-mono text-[#9E968D]">
            Total Traced: <strong className="text-[#2C2623]">₹{hoppingData?.total_siphoned_inr?.toLocaleString() || "0"}</strong>
          </div>
        </div>

        {/* Pipeline Hop Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {hoppingData?.hop_pipeline && hoppingData.hop_pipeline.length > 0 ? (
            hoppingData.hop_pipeline.map((hop) => {
              const isSelected = selectedHop === hop.hop_number;
              return (
                <div
                  key={hop.hop_number}
                  onClick={() => setSelectedHop(isSelected ? null : hop.hop_number)}
                  className={`border rounded-xl p-4 transition-all cursor-pointer ${
                    isSelected
                      ? "border-[#7C3AED] bg-[#FAF6EE] shadow-sm ring-2 ring-[#7C3AED]/20"
                      : "border-[#E8E2D5] bg-white hover:border-[#7C3AED]/40 hover:bg-[#FAF6EE]/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9E968D]">
                      HOP {hop.hop_number}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] font-bold">
                      {hop.retention_percentage}% of Total
                    </span>
                  </div>

                  <h4 className="font-bold text-xs text-[#2C2623] font-serif mb-3 line-clamp-1">
                    {hop.title}
                  </h4>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-[#746D65]">
                      <span>Volume:</span>
                      <strong className="text-[#2C2623] font-mono">₹{hop.total_volume_inr?.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between text-[#746D65]">
                      <span>Accounts:</span>
                      <strong className="text-[#2C2623] font-mono">{hop.accounts_count} Mules</strong>
                    </div>
                    <div className="flex justify-between text-[#746D65]">
                      <span>Avg Velocity:</span>
                      <span className="font-mono text-xs font-bold text-[#D96B27] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {hop.avg_velocity_minutes > 0 ? `${hop.avg_velocity_minutes} min` : "Instant"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-4 p-8 text-center text-xs text-[#9E968D]">
              No multi-hop transitions recorded for this account.
            </div>
          )}
        </div>

        {/* Selected Hop Chronological Transfers Drawer */}
        {selectedHop && selectedHopData && (
          <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#2C2623] flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#D96B27]" />
                  Hop {selectedHop} Chronological Transfer Execution Log
                  <span className="text-xs font-mono font-normal text-[#746D65]">
                    ({selectedHopData.transactions?.length || 0} transfers • ₹{selectedHopData.total_volume_inr?.toLocaleString()})
                  </span>
                </h4>
                <p className="text-[11px] text-[#746D65] mt-0.5">
                  Sequential transfer timeline and velocity deltas recorded for Hop {selectedHop}.
                </p>
              </div>
              <button
                onClick={() => setSelectedHop(null)}
                className="text-xs font-mono text-[#9E968D] hover:text-[#2C2623] border border-[#E8E2D5] px-2.5 py-1 rounded-lg bg-white cursor-pointer"
              >
                Close Drawer
              </button>
            </div>

            <div className="overflow-x-auto max-h-60 rounded-lg border border-[#E8E2D5] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5EFE6] text-[#746D65] uppercase text-[10px] font-mono sticky top-0 border-b border-[#E8E2D5]">
                  <tr>
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Txn ID</th>
                    <th className="py-2 px-3">Sender</th>
                    <th className="py-2 px-3">Receiver</th>
                    <th className="py-2 px-3">Amount (₹)</th>
                    <th className="py-2 px-3">Velocity Delta</th>
                    <th className="py-2 px-3">Mode</th>
                    <th className="py-2 px-3">Narration</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EAE1] font-mono">
                  {selectedHopData.transactions?.map((t) => (
                    <tr key={t.txn_id} className="hover:bg-[#FAF6EE] transition-colors">
                      <td className="py-2 px-3 text-[#746D65] text-[11px] whitespace-nowrap">
                        {t.timestamp}
                      </td>
                      <td className="py-2 px-3 font-bold text-[#2C2623] text-[11px]">
                        {t.txn_id}
                      </td>
                      <td className="py-2 px-3 text-[#2C2623] text-[11px]">
                        {t.from}
                      </td>
                      <td className="py-2 px-3 text-[#7C3AED] font-bold text-[11px]">
                        {t.to}
                      </td>
                      <td className="py-2 px-3 font-bold text-[#2C2623]">
                        ₹{t.amount?.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-[#D96B27] font-bold text-[11px]">
                        {t.latency_min > 0 ? `+${t.latency_min} min` : "Instant"}
                      </td>
                      <td className="py-2 px-3 text-[10px]">
                        <span className="bg-[#FAF6EE] border border-[#E8E2D5] px-1.5 py-0.5 rounded text-[#746D65]">
                          {t.mode}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[#746D65] text-[11px] truncate max-w-[150px]" title={t.narration}>
                        {t.narration}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => inspectAccount(t.to)}
                          className="text-[11px] font-bold text-[#7C3AED] hover:underline cursor-pointer"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Node Table with PyTorch GAT Attention Scores */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-[#E8E2D5] bg-[#FAF6EE] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-[#2C2623] font-serif flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#7C3AED]" />
              HAMI Node Classification & PyTorch GAT Attention Scores
            </h3>
            <p className="text-[11px] text-[#746D65]">
              Ranked by GNN attention weights and topological branching severity.
            </p>
          </div>
          <div className="text-xs font-mono text-[#9E968D]">
            {hoppingData?.nodes?.length || 0} Correlated Accounts
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F5EFE6] text-[#746D65] uppercase text-[10px] font-mono sticky top-0 z-10 border-b border-[#E8E2D5]">
              <tr>
                <th className="py-2.5 px-4">Account ID</th>
                <th className="py-2.5 px-3">Hop</th>
                <th className="py-2.5 px-3">Bank / IFSC</th>
                <th className="py-2.5 px-3">HAMI Role</th>
                <th className="py-2.5 px-3">In / Out Deg</th>
                <th className="py-2.5 px-3">GAT Attention Score</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EAE1]">
              {hoppingData?.nodes?.map((node) => {
                const isCycle = node.is_cycle_participant;
                const isTerminal = node.out_degree === 0 && node.hop > 0;
                return (
                  <tr
                    key={node.account_id}
                    className={`hover:bg-[#FAF6EE] transition-colors ${isCycle ? "bg-red-50/50" : ""}`}
                  >
                    <td className="py-2.5 px-4 font-mono font-bold text-[#2C2623] flex items-center gap-1.5">
                      <span>{node.account_id}</span>
                      <button
                        onClick={() => handleCopy(node.account_id)}
                        className="text-[#9E968D] hover:text-[#2C2623] cursor-pointer"
                        title="Copy Account"
                      >
                        {copiedId === node.account_id ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      </button>
                      {isCycle && (
                        <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-mono font-bold">
                          CYCLE
                        </span>
                      )}
                      {isTerminal && (
                        <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono font-bold">
                          TERMINAL CASH-OUT
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#746D65]">
                      Hop {node.hop}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-[#746D65]">
                      {node.ifsc}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-[#FAF6EE] border border-[#E8E2D5] text-[#2C2623]">
                        {node.hami_role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs">
                      <span className="text-blue-700 font-bold">{node.in_degree} In</span> •{" "}
                      <span className="text-orange-700 font-bold">{node.out_degree} Out</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              node.gat_attention_score >= 85
                                ? "bg-red-600"
                                : node.gat_attention_score >= 70
                                ? "bg-orange-500"
                                : "bg-blue-600"
                            }`}
                            style={{ width: `${Math.min(node.gat_attention_score, 100)}%` }}
                          ></div>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#2C2623]">
                          {node.gat_attention_score}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#2C2623]">
                      ₹{node.amount?.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => inspectAccount(node.account_id)}
                          className="text-[11px] font-bold text-[#2C2623] hover:text-[#7C3AED] hover:underline cursor-pointer"
                          title="Inspect hopping network for this account"
                        >
                          Inspect
                        </button>
                        {node.hop > 0 && (
                          <button
                            onClick={() => {
                              if (onSelectVictim) onSelectVictim(node.account_id);
                              if (onNavigateTab) onNavigateTab("trail");
                            }}
                            className="text-[11px] font-bold text-[#7C3AED] hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>Trace</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Top HAMI Hopping Clusters Scanned across 2M Transactions */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-serif font-bold text-base text-[#2C2623] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#D96B27]" />
              Top HAMI Hopping Clusters in Database (2,000,000 Transactions)
            </h3>
            <p className="text-xs text-[#746D65] mt-0.5">
              Identifies active multi-hop syndicates based on high fan-in/fan-out ratios and rapid money cycling.
            </p>
          </div>

          {/* Pattern Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-[#FAF6EE] p-1 rounded-xl border border-[#E8E2D5] text-xs">
            {["ALL", "Scatter-Gather", "Fan-Out", "Fan-In", "Cycle"].map((pat) => (
              <button
                key={pat}
                onClick={() => setActivePatternFilter(pat)}
                className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                  activePatternFilter === pat
                    ? "bg-[#2C2623] text-white"
                    : "text-[#746D65] hover:text-[#2C2623]"
                }`}
              >
                {pat}
              </button>
            ))}
          </div>
        </div>

        {/* Clusters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClusters.slice(0, 9).map((c) => {
            const patBadge = getPatternBadge(c.hami_pattern);
            const CIcon = patBadge.icon;
            return (
              <div
                key={c.cluster_id}
                className="border border-[#E8E2D5] bg-[#FAF6EE] rounded-xl p-4 space-y-3 hover:border-[#7C3AED] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1 ${patBadge.bg}`}>
                    <CIcon className="w-3 h-3" />
                    <span>{c.hami_pattern}</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#9E968D]">
                    ID: {c.cluster_id}
                  </span>
                </div>

                <div>
                  <div className="text-[11px] text-[#746D65]">Anchor Account</div>
                  <div className="font-mono font-bold text-sm text-[#2C2623] flex items-center justify-between">
                    <span>{c.anchor_account}</span>
                    <button
                      onClick={() => inspectAccount(c.anchor_account)}
                      className="text-[11px] font-bold text-[#7C3AED] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Analyze</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-[#9E968D]">{c.ifsc} • {c.role}</div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E8E2D5] text-center text-xs">
                  <div>
                    <div className="text-[10px] text-[#9E968D] font-mono">Senders</div>
                    <strong className="text-blue-700 font-mono">{c.fan_in_count}</strong>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9E968D] font-mono">Receivers</div>
                    <strong className="text-orange-700 font-mono">{c.fan_out_count}</strong>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9E968D] font-mono">GAT Score</div>
                    <strong className="text-red-700 font-mono">{c.gat_confidence}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
