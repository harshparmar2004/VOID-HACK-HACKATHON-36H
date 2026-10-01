import React, { useState, useRef, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut, Maximize2, Shield, Info } from "lucide-react";

export default function NetworkGraphView({ traceData }) {
  const fgRef = useRef();
  const [selectedNode, setSelectedNode] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeProgress, setTimeProgress] = useState(100); // 0 to 100% of 15 days

  const nodes = traceData?.nodes || [];
  const links = traceData?.links || [];

  // Filter links based on temporal slider
  const visibleLinks = links.slice(0, Math.max(1, Math.floor((links.length * timeProgress) / 100)));
  const visibleNodeIds = new Set();
  visibleLinks.forEach((l) => {
    visibleNodeIds.add(typeof l.source === 'object' ? l.source.id : l.source);
    visibleNodeIds.add(typeof l.target === 'object' ? l.target.id : l.target);
  });
  if (nodes.length > 0) visibleNodeIds.add(nodes[0].id);

  const visibleNodes = nodes.filter((n) => visibleNodeIds.has(n.id));

  // Role Color Mapping
  const getNodeColor = (role) => {
    switch (role) {
      case "VICTIM": return "#10B981"; // Green
      case "L1_COLLECTOR": return "#EA580C"; // Vibrant Orange
      case "L2_DISTRIBUTOR": return "#D97706"; // Amber / Gold
      case "L3_CASHOUT": return "#7C3AED"; // Purple
      default: return "#6B7280";
    }
  };

  // Temporal Playback Loop
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setTimeProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return prev + 5;
        });
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="space-y-4">
      {/* Top Controls & Legend */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2C2623]">
            Interactive Mule Network Flow Graph
          </h2>
          <p className="text-xs text-[#746D65]">
            Visualizes multi-tier fund propagation from victim to terminal cashouts. Click any node to inspect.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#10B981]"></span>
            <span className="text-[#2C2623]">Victim</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#EA580C]"></span>
            <span className="text-[#2C2623]">L1 Collector</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#D97706]"></span>
            <span className="text-[#2C2623]">L2 Distributor (50)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#7C3AED]"></span>
            <span className="text-[#2C2623]">L3 Cashout</span>
          </div>
        </div>
      </div>

      {/* Graph Canvas Container */}
      <div className="relative bg-[#FAF6EE] border border-[#E8E2D5] rounded-2xl overflow-hidden h-[540px] shadow-inner">
        <ForceGraph2D
          ref={fgRef}
          graphData={{ nodes: visibleNodes, links: visibleLinks }}
          nodeLabel={(n) => `
            <div style="background:#2C2623; color:#fff; padding:6px 10px; border-radius:8px; font-size:12px; font-family:sans-serif;">
              <b>${n.label}</b><br/>
              Bank: ${n.bank} (${n.ifsc})<br/>
              Risk Score: <b>${n.risk_score}</b><br/>
              Trapped Balance: ₹${n.holding_amount?.toLocaleString('en-IN') || 0}
            </div>
          `}
          nodeColor={(n) => getNodeColor(n.role)}
          nodeRelSize={7}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkColor={() => "#C4BCAD"}
          linkWidth={1.5}
          linkCurvature={0.15}
          onNodeClick={(node) => setSelectedNode(node)}
          cooldownTicks={100}
        />

        {/* Floating Node Inspector (Side Card) */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-72 bg-white/95 backdrop-blur border border-[#E8E2D5] rounded-2xl p-4 shadow-lg text-xs space-y-2 z-10">
            <div className="flex items-center justify-between border-b border-[#E8E2D5] pb-2">
              <span className="font-mono font-bold text-[#2C2623]">{selectedNode.id}</span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-[#9E968D] hover:text-[#2C2623] font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div>
              <span className="text-[#9E968D] uppercase font-mono text-[10px]">Role / Hop:</span>
              <div className="font-bold text-[#D96B27]">{selectedNode.role} (Hop {selectedNode.hop})</div>
            </div>
            <div>
              <span className="text-[#9E968D] uppercase font-mono text-[10px]">Bank / IFSC:</span>
              <div className="font-medium text-[#2C2623]">{selectedNode.bank} • {selectedNode.ifsc}</div>
            </div>
            <div>
              <span className="text-[#9E968D] uppercase font-mono text-[10px]">Mule Risk Index:</span>
              <div className="font-mono font-bold text-[#DC2626]">{selectedNode.risk_score} / 100 ({selectedNode.risk_band})</div>
            </div>
            <div>
              <span className="text-[#9E968D] uppercase font-mono text-[10px]">Trapped Balance (Lien Target):</span>
              <div className="font-mono font-bold text-[#059669] text-sm">
                ₹{selectedNode.holding_amount?.toLocaleString('en-IN') || 0}
              </div>
            </div>
            <div className="pt-1 text-[11px] text-[#746D65] italic">
              {selectedNode.reasons}
            </div>
          </div>
        )}
      </div>

      {/* 15-Day Temporal Playback Bar */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-8 h-8 rounded-lg bg-[#D96B27] hover:bg-[#C25B1C] text-white flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button
              onClick={() => { setIsPlaying(false); setTimeProgress(100); }}
              className="w-8 h-8 rounded-lg bg-[#F3EDE2] hover:bg-[#EAE4D8] text-[#2C2623] flex items-center justify-center transition-colors cursor-pointer"
              title="Reset Timeline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <span className="font-medium text-[#2C2623]">15-Day Minute-by-Minute Temporal Replay</span>
          </div>

          <span className="font-mono text-xs text-[#746D65]">
            Progress: {timeProgress}% ({visibleLinks.length} / {links.length} Transfers Visible)
          </span>
        </div>

        <input
          type="range"
          min="5"
          max="100"
          value={timeProgress}
          onChange={(e) => { setIsPlaying(false); setTimeProgress(Number(e.target.value)); }}
          className="w-full accent-[#D96B27] cursor-pointer"
        />
      </div>
    </div>
  );
}
