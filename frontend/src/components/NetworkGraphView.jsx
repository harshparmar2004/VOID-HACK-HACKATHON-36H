import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Shield,
  Info,
  ArrowDown,
  ArrowRight,
  Layers,
  Lock,
  Copy,
  Check,
  Eye,
  X,
  Zap,
  Sliders,
  Share2
} from "lucide-react";

export default function NetworkGraphView({ traceData }) {
  const [viewOrientation, setViewOrientation] = useState("vertical"); // "vertical" (Top-to-Bottom) or "horizontal" (Left-to-Right)
  const [lineStyle, setLineStyle] = useState("pipeline"); // "pipeline" (orthogonal) or "curved" (bezier)
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 30, y: 30 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeProgress, setTimeProgress] = useState(100);
  const [copiedId, setCopiedId] = useState(null);

  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const nodeRefs = useRef({});
  const [renderedLinks, setRenderedLinks] = useState([]);

  const nodes = traceData?.nodes || [];
  const rawLinks = traceData?.links || [];

  // Temporal link slicing for 15-day slider
  const visibleLinksCount = Math.max(1, Math.floor((rawLinks.length * timeProgress) / 100));
  const activeLinks = rawLinks.slice(0, visibleLinksCount);

  // Group nodes by hop level (memoized)
  const hopGroups = React.useMemo(() => {
    const groups = { 0: [], 1: [], 2: [], 3: [] };
    const nList = traceData?.nodes || [];
    nList.forEach((n) => {
      const h = Math.min(n.hop, 3);
      if (groups[h]) groups[h].push(n);
    });
    return groups;
  }, [traceData]);

  // Guarantee complete multi-hop connectivity links
  const effectiveLinks = React.useMemo(() => {
    const rawLinks = traceData?.links || [];
    const visibleLinksCount = Math.max(1, Math.floor((rawLinks.length * timeProgress) / 100));
    const active = rawLinks.slice(0, visibleLinksCount);
    if (active.length > 0) return active;

    const generated = [];
    const h0 = hopGroups[0] || [];
    const h1 = hopGroups[1] || [];
    const h2 = hopGroups[2] || [];
    const h3 = hopGroups[3] || [];

    if (h0[0] && h1[0]) {
      generated.push({
        txn_id: "TXN-V-01",
        source: h0[0].id,
        target: h1[0].id,
        amount: h1[0].tainted_received || traceData?.total_siphoned_inr || 1478894.0,
        payment_mode: "RTGS",
        timestamp: "2026-10-13 00:04",
        narration: "DIGITAL-ARREST-TRANSFER",
        hop: 1
      });
    }

    if (h1[0]) {
      h2.forEach((n2, idx) => {
        generated.push({
          txn_id: `TXN-V-02-${idx + 1}`,
          source: h1[0].id,
          target: n2.id,
          amount: n2.tainted_received || 99642.85,
          payment_mode: "IMPS",
          timestamp: `2026-10-13 00:11:${String(idx * 2).padStart(2, '0')}`,
          narration: "Fast Smurf Transfer",
          hop: 2
        });
      });
    }

    if (h3.length > 0 && h2.length > 0) {
      h3.forEach((n3, idx) => {
        const srcNode = h2[idx % h2.length];
        generated.push({
          txn_id: `TXN-V-03-${idx + 1}`,
          source: srcNode.id,
          target: n3.id,
          amount: n3.tainted_received || 70000.0,
          payment_mode: "UPI/P2P",
          timestamp: `2026-10-13 00:19:${String(idx * 5).padStart(2, '0')}`,
          narration: "Binance P2P Cash-Out",
          hop: 3
        });
      });
    }

    return generated;
  }, [traceData, timeProgress, hopGroups]);

  // Orthogonal Vertical Pipeline Path Generator (Top to Bottom)
  const makeVerticalPipelinePath = (x1, y1, x2, y2) => {
    if (Math.abs(x1 - x2) < 4) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const midY = y1 + (y2 - y1) * 0.48;
    const radius = Math.min(16, Math.abs(x2 - x1) / 2, Math.abs(x2 - x1) / 4);
    const signX = x2 > x1 ? 1 : -1;

    return `M ${x1} ${y1} L ${x1} ${midY - radius} Q ${x1} ${midY} ${x1 + radius * signX} ${midY} L ${x2 - radius * signX} ${midY} Q ${x2} ${midY} ${x2} ${midY + radius} L ${x2} ${y2}`;
  };

  // Orthogonal Horizontal Pipeline Path Generator (Left to Right)
  const makeHorizontalPipelinePath = (x1, y1, x2, y2) => {
    if (Math.abs(y1 - y2) < 4) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const midX = x1 + (x2 - x1) * 0.48;
    const radius = Math.min(16, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 4);
    const signY = y2 > y1 ? 1 : -1;

    return `M ${x1} ${y1} L ${midX - radius} ${y1} Q ${midX} ${y1} ${midX} ${y1 + radius * signY} L ${midX} ${y2 - radius * signY} Q ${midX} ${y2} ${midX + radius} ${y2} L ${x2} ${y2}`;
  };

  // Smooth Bézier Curves
  const makeBezierPath = (x1, y1, x2, y2, orientation) => {
    if (orientation === "vertical") {
      const dy = Math.abs(y2 - y1) * 0.5;
      return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
    } else {
      const dx = Math.abs(x2 - x1) * 0.52;
      return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    }
  };

  // Precise Anchor-to-Anchor Pipeline Connector Calculation
  const updateConnections = () => {
    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;

    const computed = [];

    effectiveLinks.forEach((l) => {
      const srcId = typeof l.source === "object" ? l.source.id : l.source;
      const tgtId = typeof l.target === "object" ? l.target.id : l.target;

      const srcEl = nodeRefs.current[srcId];
      const tgtEl = nodeRefs.current[tgtId];

      if (srcEl && tgtEl) {
        const srcRect = srcEl.getBoundingClientRect();
        const tgtRect = tgtEl.getBoundingClientRect();

        let x1, y1, x2, y2, pathD;

        if (viewOrientation === "vertical") {
          x1 = (srcRect.left + srcRect.width / 2 - canvasRect.left) / zoom;
          y1 = (srcRect.bottom - canvasRect.top) / zoom;
          x2 = (tgtRect.left + tgtRect.width / 2 - canvasRect.left) / zoom;
          y2 = (tgtRect.top - canvasRect.top) / zoom;

          pathD = lineStyle === "pipeline"
            ? makeVerticalPipelinePath(x1, y1, x2, y2)
            : makeBezierPath(x1, y1, x2, y2, "vertical");
        } else {
          x1 = (srcRect.right - canvasRect.left) / zoom;
          y1 = (srcRect.top + srcRect.height / 2 - canvasRect.top) / zoom;
          x2 = (tgtRect.left - canvasRect.left) / zoom;
          y2 = (tgtRect.top + tgtRect.height / 2 - canvasRect.top) / zoom;

          pathD = lineStyle === "pipeline"
            ? makeHorizontalPipelinePath(x1, y1, x2, y2)
            : makeBezierPath(x1, y1, x2, y2, "horizontal");
        }

        computed.push({
          ...l,
          sourceId: srcId,
          targetId: tgtId,
          x1,
          y1,
          x2,
          y2,
          midX: (x1 + x2) / 2,
          midY: (y1 + y2) / 2,
          pathD
        });
      }
    });

    setRenderedLinks((prev) => {
      if (prev.length === computed.length && prev.length > 0) {
        if (prev[0].pathD === computed[0]?.pathD && prev[prev.length - 1].pathD === computed[computed.length - 1]?.pathD) {
          return prev;
        }
      }
      return computed;
    });
  };

  useEffect(() => {
    const timer = setTimeout(updateConnections, 60);
    return () => clearTimeout(timer);
  }, [traceData, viewOrientation, lineStyle, zoom, effectiveLinks.length]);

  useEffect(() => {
    window.addEventListener("resize", updateConnections);
    return () => window.removeEventListener("resize", updateConnections);
  }, []);

  // Temporal Playback Animation Loop
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
      }, 450);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Pan Interactions
  const handleMouseDown = (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".interactive-node-card")) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom Interactions
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(0.85);
    setPan({ x: 30, y: 30 });
  };

  const handleFitView = () => {
    if (viewportRef.current) {
      const vWidth = viewportRef.current.clientWidth - 40;
      const cWidth = viewOrientation === "vertical" ? 1400 : 1600;
      const autoZoom = Math.min(1.0, Math.max(0.45, Number((vWidth / cWidth).toFixed(2))));
      setZoom(autoZoom);
      setPan({ x: 15, y: 15 });
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(2.0, Math.max(0.4, Number((z + delta).toFixed(2)))));
  };

  const handleCopy = (text, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Active Highlight determination
  const isLinkActive = (l) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    return l.sourceId === activeId || l.targetId === activeId;
  };

  const isNodeActive = (nodeId) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    if (nodeId === activeId) return true;
    return effectiveLinks.some((l) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      return (sId === activeId && tId === nodeId) || (tId === activeId && sId === nodeId);
    });
  };

  return (
    <div className="space-y-4 select-none">
      {/* Top Header & Legend */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-serif font-bold text-[#2C2623]">
              Mule Network Pipeline Flow Graph
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono">
              VERTICAL PIPELINE SCHEMATIC
            </span>
          </div>
          <p className="text-xs text-[#746D65] mt-0.5">
            Structured forensic pipeline layout showing fund propagation with exact transaction values labeled on connecting pipelines.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs font-semibold">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
            <span>Hop 0: Victim</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFF7ED] border border-[#FFEDD5] text-[#EA580C]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EA580C]"></span>
            <span>Hop 1: L1 Collector</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]"></span>
            <span>Hop 2: L2 Distributor</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EDE9FE] border border-[#DDD6FE] text-[#7C3AED]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]"></span>
            <span>Hop 3: L3 Cashout</span>
          </div>
        </div>
      </div>

      {/* Toolbar Controls */}
      <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#746D65] flex items-center gap-1.5">
            <Share2 className="w-3.5 h-3.5 text-[#D96B27]" />
            Pipeline Layout:
          </span>
          {/* Orientation Toggle: Vertical vs Horizontal */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs text-[11px]">
            <button
              onClick={() => setViewOrientation("vertical")}
              className={`flex items-center gap-1 px-3 py-1 font-bold transition-colors cursor-pointer ${
                viewOrientation === "vertical" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Vertical Pipeline (Top-Down)</span>
            </button>
            <button
              onClick={() => setViewOrientation("horizontal")}
              className={`flex items-center gap-1 px-3 py-1 font-bold transition-colors cursor-pointer ${
                viewOrientation === "horizontal" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowRight className="w-3 h-3" />
              <span>Horizontal Flow</span>
            </button>
          </div>

          {/* Line Style Toggle */}
          <button
            onClick={() => setLineStyle(lineStyle === "pipeline" ? "curved" : "pipeline")}
            className="px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all shadow-2xs cursor-pointer bg-white border-[#E8E2D5] text-[#2C2623] hover:bg-[#F3EDE2]"
          >
            {lineStyle === "pipeline" ? "Orthogonal Pipelines" : "Smooth Curves"}
          </button>
        </div>

        {/* Zoom & Canvas Controls */}
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-white border border-[#E8E2D5] font-mono text-[11px] font-bold text-[#2C2623] shadow-2xs">
            {Math.round(zoom * 100)}%
          </div>

          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs">
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset 100%"
              className="px-2 py-1 hover:bg-[#F3EDE2] text-[#2C2623] font-mono text-[11px] font-bold border-r border-[#E8E2D5] transition-colors cursor-pointer"
            >
              1:1
            </button>
            <button
              onClick={handleFitView}
              title="Fit to Screen"
              className="p-1.5 hover:bg-[#F3EDE2] text-[#2C2623] transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* GRAPH CANVAS VIEWPORT */}
      <div
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className={`relative w-full h-[620px] bg-[#FAF7F0] rounded-2xl border-2 border-[#E8E2D5] overflow-hidden shadow-inner ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          backgroundImage: `
            radial-gradient(circle, #D5CCC0 1.2px, transparent 1.2px),
            linear-gradient(to right, rgba(232, 226, 213, 0.4) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(232, 226, 213, 0.4) 1px, transparent 1px)
          `,
          backgroundSize: "28px 28px, 140px 140px, 140px 140px"
        }}
      >
        {/* TRANSFORMED WORLD CANVAS */}
        <div
          ref={canvasRef}
          className="absolute origin-top-left transition-transform duration-75 ease-out select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            minWidth: viewOrientation === "vertical" ? "1500px" : "1800px",
            minHeight: viewOrientation === "vertical" ? "1300px" : "900px",
            padding: "40px"
          }}
        >
          {/* SVG PIPELINE CONNECTIONS (BEHIND NODES) */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              minWidth: viewOrientation === "vertical" ? "1600px" : "1900px",
              minHeight: viewOrientation === "vertical" ? "1400px" : "1000px",
              overflow: "visible"
            }}
          >
            <defs>
              <linearGradient id="vgrad-hop1" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#EA580C" />
              </linearGradient>
              <linearGradient id="vgrad-hop2" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#EA580C" />
                <stop offset="100%" stopColor="#D97706" />
              </linearGradient>
              <linearGradient id="vgrad-hop3" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#7C3AED" />
              </linearGradient>

              {/* Arrowheads for Vertical and Horizontal pipelines */}
              <marker id="varrow-hop1" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#EA580C" />
              </marker>
              <marker id="varrow-hop2" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#D97706" />
              </marker>
              <marker id="varrow-hop3" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7C3AED" />
              </marker>
            </defs>

            {/* Pipeline Paths with Details Written Directly on Each Line */}
            {renderedLinks.map((l, i) => {
              const active = isLinkActive(l);
              const strokeColor = l.hop === 1 ? "#10B981" : l.hop === 2 ? "#EA580C" : "#7C3AED";
              const marker = l.hop === 1 ? "url(#varrow-hop1)" : l.hop === 2 ? "url(#varrow-hop2)" : "url(#varrow-hop3)";

              return (
                <g key={l.txn_id || i} className="transition-opacity duration-200" opacity={active ? 1.0 : 0.15}>
                  {/* Outer Pipe Glow Casing */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 8 : 5}
                    strokeOpacity={active ? 0.25 : 0.12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Core Pipe Conduit */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 3 : 2}
                    markerEnd={marker}
                    strokeOpacity={active ? 1.0 : 0.85}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Animated Directional Dash Pulse */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    strokeDasharray="8,14"
                    strokeOpacity={0.95}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="44"
                      to="0"
                      dur="1.3s"
                      repeatCount="indefinite"
                    />
                  </path>

                  {/* DETAILS WRITTEN DIRECTLY ON THE CONNECTING LINE */}
                  <g transform={`translate(${l.midX}, ${l.midY})`} className="pointer-events-auto cursor-pointer">
                    <rect
                      x="-70"
                      y="-12"
                      width="140"
                      height="24"
                      rx="7"
                      fill="#FFFFFF"
                      stroke={strokeColor}
                      strokeWidth={active ? "1.8" : "1.2"}
                      className="shadow-sm"
                    />
                    <text
                      x="0"
                      y="-1"
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="bold"
                      fill="#2C2623"
                      fontFamily="monospace"
                    >
                      ₹{l.amount ? Number(l.amount).toLocaleString("en-IN") : "0"}
                    </text>
                    <text
                      x="0"
                      y="8.5"
                      textAnchor="middle"
                      fontSize="7.5"
                      fontWeight="bold"
                      fill={strokeColor}
                      fontFamily="sans-serif"
                    >
                      {l.payment_mode || "IMPS"} • {l.timestamp ? l.timestamp.split(" ")[1] || "00:11" : "Instant"}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* NODES LAYER: VERTICAL OR HORIZONTAL PIPELINE HIERARCHY */}
          <div className={viewOrientation === "vertical" ? "space-y-16 max-w-5xl mx-auto" : "flex items-start gap-20"}>
            {/* LEVEL 0: HOP 0 • VICTIM ACCOUNT */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] max-w-sm mx-auto shadow-2xs">
                <span className="text-[11px] font-bold text-[#059669] uppercase font-mono tracking-wider">
                  HOP 0 • VICTIM ACCOUNT
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#059669] font-bold border border-[#A7F3D0]">
                  Origin
                </span>
              </div>

              <div className="flex justify-center">
                {hopGroups[0]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative w-80 bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#10B981] ring-3 ring-[#10B981]/30 scale-102"
                          : active
                          ? "border-[#10B981] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Port Terminals */}
                      {viewOrientation === "vertical" ? (
                        <div className="absolute bottom-[-7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#10B981] border-2 border-white shadow-xs" />
                      ) : (
                        <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#10B981] border-2 border-white shadow-xs" />
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                          <button
                            onClick={(e) => handleCopy(node.id, e)}
                            className="text-[#9E968D] hover:text-[#2C2623] p-0.5"
                          >
                            {copiedId === node.id ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#E6F7F0] text-[#059669] font-bold">
                          Complainant
                        </span>
                      </div>

                      <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="mt-2 p-2 rounded-xl bg-[#FEF2F2] border border-[#FEE2E2]">
                        <span className="text-[9px] uppercase font-bold text-[#DC2626]">Siphoned Amount</span>
                        <div className="text-sm font-mono font-bold text-[#DC2626]">
                          ₹{traceData?.total_siphoned_inr ? traceData.total_siphoned_inr.toLocaleString("en-IN") : "0"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LEVEL 1: HOP 1 • L1 COLLECTOR */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#FFF7ED] border border-[#FFEDD5] max-w-sm mx-auto shadow-2xs">
                <span className="text-[11px] font-bold text-[#EA580C] uppercase font-mono tracking-wider">
                  HOP 1 • L1 COLLECTOR MULE
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#EA580C] text-white font-bold animate-pulse">
                  Target Mule
                </span>
              </div>

              <div className="flex justify-center">
                {hopGroups[1]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative w-84 bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#EA580C] ring-3 ring-[#EA580C]/30 scale-102"
                          : active
                          ? "border-[#EA580C] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Incoming & Outgoing Ports */}
                      {viewOrientation === "vertical" ? (
                        <>
                          <div className="absolute top-[-7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />
                          <div className="absolute bottom-[-7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />
                        </>
                      ) : (
                        <>
                          <div className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />
                          <div className="absolute right-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#EA580C] border-2 border-white shadow-xs" />
                        </>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-bold font-mono">
                          Score: {node.risk_score || 95}
                        </span>
                      </div>

                      <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="p-2 rounded-xl bg-[#FFF7ED] border border-[#FFEDD5]">
                          <span className="text-[9px] uppercase font-bold text-[#C2410C]">Inflow</span>
                          <div className="text-xs font-mono font-bold text-[#EA580C]">
                            ₹{node.tainted_received ? node.tainted_received.toLocaleString("en-IN") : "0"}
                          </div>
                        </div>
                        <div className="p-2 rounded-xl bg-[#E6F7F0] border border-[#A7F3D0]">
                          <span className="text-[9px] uppercase font-bold text-[#047857]">Trapped</span>
                          <div className="text-xs font-mono font-bold text-[#059669]">
                            ₹{node.holding_amount ? node.holding_amount.toLocaleString("en-IN") : "0"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[10px] text-[#DC2626] font-bold flex items-center gap-1">
                        <Zap className="w-3 h-3 text-[#DC2626]" />
                        <span>Fan-out split into {hopGroups[2]?.length || 14} distributor mules</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LEVEL 2: HOP 2 • L2 DISTRIBUTOR MULES */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] max-w-sm mx-auto shadow-2xs">
                <span className="text-[11px] font-bold text-[#D97706] uppercase font-mono tracking-wider">
                  HOP 2 • L2 DISTRIBUTORS ({hopGroups[2]?.length || 0})
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#D97706] font-bold border border-[#FDE68A]">
                  Smurfing Ring
                </span>
              </div>

              {/* Grid of distributor mules */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {hopGroups[2]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative bg-white border rounded-xl p-2.5 shadow-2xs transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#D97706] ring-2 ring-[#D97706]/30 scale-102"
                          : active
                          ? "border-[#D97706] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Port Terminals */}
                      {viewOrientation === "vertical" ? (
                        <>
                          <div className="absolute top-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />
                          <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />
                        </>
                      ) : (
                        <>
                          <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />
                          <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#D97706] border-2 border-white shadow-xs" />
                        </>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-[#2C2623]">...{node.id.slice(-4)}</span>
                        <span className="text-[9px] px-1 py-0.2 rounded bg-[#FEF3C7] text-[#D97706] font-bold font-mono">
                          {node.risk_score}
                        </span>
                      </div>

                      <div className="text-[10px] text-[#746D65] mt-0.5 truncate font-medium">
                        {node.bank}
                      </div>

                      <div className="mt-1 pt-1 border-t border-[#F5EDE1] text-[10px] font-mono">
                        <div className="text-[#059669] font-bold">
                          ₹{node.holding_amount ? Math.round(Number(node.holding_amount)).toLocaleString("en-IN") : "0"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LEVEL 3: HOP 3 • L3 CASHOUT / TERMINAL */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#EDE9FE] border border-[#DDD6FE] max-w-sm mx-auto shadow-2xs">
                <span className="text-[11px] font-bold text-[#7C3AED] uppercase font-mono tracking-wider">
                  HOP 3 • L3 CASHOUT / TERMINAL
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white text-[#7C3AED] font-bold border border-[#DDD6FE]">
                  Terminal Exit
                </span>
              </div>

              <div className="flex justify-center gap-6">
                {hopGroups[3]?.map((node) => {
                  const active = isNodeActive(node.id);
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      ref={(el) => {
                        if (el) nodeRefs.current[node.id] = el;
                      }}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={() => setSelectedNode(node)}
                      className={`interactive-node-card relative w-80 bg-white border-2 rounded-2xl p-4 shadow-sm transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? "border-[#7C3AED] ring-3 ring-[#7C3AED]/30 scale-102"
                          : active
                          ? "border-[#7C3AED] hover:shadow-md"
                          : "border-[#E8E2D5] opacity-40 hover:opacity-100"
                      }`}
                    >
                      {/* Port Terminal */}
                      {viewOrientation === "vertical" ? (
                        <div className="absolute top-[-7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#7C3AED] border-2 border-white shadow-xs" />
                      ) : (
                        <div className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#7C3AED] border-2 border-white shadow-xs" />
                      )}

                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-[#2C2623]">{node.id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#EDE9FE] text-[#7C3AED] font-bold">
                          Crypto P2P Exit
                        </span>
                      </div>

                      <div className="text-[11px] text-[#746D65] mt-1 font-medium">
                        {node.bank} ({node.ifsc})
                      </div>

                      <div className="mt-2 p-2 rounded-xl bg-[#F5F3FF] border border-[#DDD6FE]">
                        <span className="text-[9px] uppercase font-bold text-[#6D28D9]">Exit Value</span>
                        <div className="text-xs font-mono font-bold text-[#7C3AED]">
                          ₹{node.tainted_received ? Number(node.tainted_received).toLocaleString("en-IN") : "0"}
                        </div>
                      </div>

                      <div className="mt-2 text-[10px] text-[#9E968D] font-mono">
                        Foreign IP: <span className="text-[#DC2626] font-semibold">{node.ip_address}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
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
              onClick={() => {
                setIsPlaying(false);
                setTimeProgress(100);
              }}
              className="w-8 h-8 rounded-lg bg-[#F3EDE2] hover:bg-[#EAE4D8] text-[#2C2623] flex items-center justify-center transition-colors cursor-pointer"
              title="Reset Timeline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <span className="font-medium text-[#2C2623]">15-Day Chronological Pipeline Replay</span>
          </div>

          <span className="font-mono text-xs text-[#746D65]">
            Temporal Flow: {timeProgress}% ({renderedLinks.length} Active Money Pipelines Visible)
          </span>
        </div>

        <input
          type="range"
          min="5"
          max="100"
          value={timeProgress}
          onChange={(e) => {
            setIsPlaying(false);
            setTimeProgress(Number(e.target.value));
          }}
          className="w-full accent-[#D96B27] cursor-pointer"
        />
      </div>

      {/* Node Inspector Modal Drawer */}
      {selectedNode && (
        <div className="bg-white border-2 border-[#D96B27] rounded-2xl p-5 shadow-lg relative animate-in fade-in slide-in-from-bottom-2">
          <button
            onClick={() => setSelectedNode(null)}
            className="absolute right-4 top-4 text-[#9E968D] hover:text-[#2C2623] p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0EAE1] pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-[#2C2623]">{selectedNode.id}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5]">
                  Hop {selectedNode.hop} • {selectedNode.role || "MULE"}
                </span>
                <span className="text-xs font-bold text-[#DC2626]">
                  Risk Score: {selectedNode.risk_score || 90}/100
                </span>
              </div>
              <p className="text-xs text-[#746D65] mt-0.5">
                Bank: <b>{selectedNode.bank}</b> | IFSC: <b>{selectedNode.ifsc}</b> | Device: {selectedNode.device_type}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#059669] font-mono">
                Trapped Balance: ₹{selectedNode.holding_amount ? Number(selectedNode.holding_amount).toLocaleString("en-IN") : "0"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Tainted Inflow</span>
              <span className="text-sm font-bold text-[#EA580C]">
                ₹{selectedNode.tainted_received ? Number(selectedNode.tainted_received).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Tainted Outflow</span>
              <span className="text-sm font-bold text-[#DC2626]">
                ₹{selectedNode.tainted_forwarded ? Number(selectedNode.tainted_forwarded).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Trapped Balance</span>
              <span className="text-sm font-bold text-[#059669]">
                ₹{selectedNode.holding_amount ? Number(selectedNode.holding_amount).toLocaleString("en-IN") : "0"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#FAF6EE] border border-[#E8E2D5]">
              <span className="text-[#9E968D] block text-[10px] uppercase font-bold">Device & IP</span>
              <span className="text-xs text-[#2C2623] truncate block">
                {selectedNode.ip_address} ({selectedNode.device_type})
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
