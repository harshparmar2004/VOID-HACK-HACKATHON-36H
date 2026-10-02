import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Shield,
  Info,
  ArrowRight,
  ArrowDown,
  GitBranch,
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
  const [treeOrientation, setTreeOrientation] = useState("horizontal"); // "horizontal" (L->R) or "vertical" (T->B)
  const [branchStyle, setBranchStyle] = useState("curved"); // "curved" (organic tree limbs) or "orthogonal" (stepped pipeline)
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 40, y: 30 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeProgress, setTimeProgress] = useState(100);
  const [copiedId, setCopiedId] = useState(null);

  const viewportRef = useRef(null);

  const nodes = traceData?.nodes || [];
  const rawLinks = traceData?.links || [];

  // Temporal link slicing for 15-day slider
  const visibleLinksCount = Math.max(1, Math.floor((rawLinks.length * timeProgress) / 100));
  const activeRawLinks = rawLinks.slice(0, visibleLinksCount);

  // Group nodes by hop level (Hops 0, 1, 2, 3, 4)
  const hopGroups = useMemo(() => {
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    nodes.forEach((n) => {
      const h = Math.min(n.hop ?? 0, 4);
      if (groups[h]) groups[h].push(n);
    });
    return groups;
  }, [nodes]);

  // Guaranteed synthetic tree links if raw links are empty
  const effectiveLinks = useMemo(() => {
    if (activeRawLinks.length > 0) return activeRawLinks;
    const generated = [];
    const h0 = hopGroups[0] || [];
    const h1 = hopGroups[1] || [];
    const h2 = hopGroups[2] || [];
    const h3 = hopGroups[3] || [];
    const h4 = hopGroups[4] || [];

    if (h0[0] && h1[0]) {
      generated.push({
        txn_id: "TXN-TREE-01",
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
          txn_id: `TXN-TREE-02-${idx + 1}`,
          source: h1[0].id,
          target: n2.id,
          amount: n2.tainted_received || 99642.85,
          payment_mode: "IMPS",
          timestamp: `2026-10-13 00:11:${String(idx * 2).padStart(2, "0")}`,
          narration: "Bunny-Hop Smurfing",
          hop: 2
        });
      });
    }

    if (h3.length > 0 && h2.length > 0) {
      h3.forEach((n3, idx) => {
        const srcNode = h2[idx % h2.length];
        generated.push({
          txn_id: `TXN-TREE-03-${idx + 1}`,
          source: srcNode.id,
          target: n3.id,
          amount: n3.tainted_received || 70000.0,
          payment_mode: "UPI/P2P",
          timestamp: `2026-10-13 00:19:${String(idx * 5).padStart(2, "0")}`,
          narration: "Crypto USDT Exit",
          hop: 3
        });
      });
    }

    if (h4.length > 0 && h3.length > 0) {
      h4.forEach((n4, idx) => {
        const srcNode = h3[idx % h3.length];
        generated.push({
          txn_id: `TXN-TREE-04-${idx + 1}`,
          source: srcNode.id,
          target: n4.id,
          amount: n4.tainted_received || 45000.0,
          payment_mode: "SWIFT/P2P",
          timestamp: `2026-10-13 00:28:${String(idx * 5).padStart(2, "0")}`,
          narration: "Offshore Crypto Terminal Exit",
          hop: 4
        });
      });
    }

    return generated;
  }, [activeRawLinks, traceData, hopGroups]);

  // PURE MATHEMATICAL HORIZONTAL & VERTICAL TREE LAYOUT ENGINE
  const treeLayout = useMemo(() => {
    const h0 = hopGroups[0] || [];
    const h1 = hopGroups[1] || [];
    const h2 = hopGroups[2] || [];
    const h3 = hopGroups[3] || [];
    const h4 = hopGroups[4] || [];

    const isHorizontal = treeOrientation === "horizontal";
    const nodeW = isHorizontal ? 260 : 220;
    const nodeH = isHorizontal ? 66 : 74;
    const hGap = isHorizontal ? 170 : 36;
    const vGap = isHorizontal ? 20 : 130;

    const nodePositions = {};
    const totalH2 = Math.max(1, h2.length);

    if (isHorizontal) {
      // HORIZONTAL TREE (Left to Right Branches)
      const h2TotalHeight = totalH2 * (nodeH + vGap) - vGap;
      const startY = 80;
      const centerY = startY + h2TotalHeight / 2;

      // Level 2 (Hop 2 Branches): distributed vertically with clean spacing
      h2.forEach((n, idx) => {
        const x = 60 + (nodeW + hGap) * 2;
        const y = startY + idx * (nodeH + vGap);
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 1 (Hop 1 Trunk): centered vertically relative to its Hop 2 branches
      h1.forEach((n) => {
        const x = 60 + (nodeW + hGap);
        const y = centerY - nodeH / 2;
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 0 (Hop 0 Root Victim): centered vertically with trunk
      h0.forEach((n) => {
        const x = 60;
        const y = centerY - nodeH / 2;
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 3 (Hop 3 Leaves): branch out to the right of their respective Hop 2 parent
      h3.forEach((n, idx) => {
        const x = 60 + (nodeW + hGap) * 3;
        const parentLink = effectiveLinks.find(
          (l) => (typeof l.target === "object" ? l.target.id : l.target) === n.id
        );
        let targetY;
        if (
          parentLink &&
          nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source]
        ) {
          targetY =
            nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source].y;
        } else {
          targetY = startY + idx * (nodeH + vGap) * 2.5;
        }
        nodePositions[n.id] = { ...n, x, y: targetY, width: nodeW, height: nodeH };
      });

      // Level 4 (Hop 4 Terminal Exit Leaves): branch out to the right of Hop 3
      h4.forEach((n, idx) => {
        const x = 60 + (nodeW + hGap) * 4;
        const parentLink = effectiveLinks.find(
          (l) => (typeof l.target === "object" ? l.target.id : l.target) === n.id
        );
        let targetY;
        if (
          parentLink &&
          nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source]
        ) {
          targetY =
            nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source].y;
        } else {
          targetY = startY + idx * (nodeH + vGap) * 2.5;
        }
        nodePositions[n.id] = { ...n, x, y: targetY, width: nodeW, height: nodeH };
      });
    } else {
      // VERTICAL TREE (Top to Bottom Branches)
      const h2TotalWidth = totalH2 * (nodeW + hGap) - hGap;
      const startX = 60;
      const centerX = startX + h2TotalWidth / 2;

      // Level 2: distributed horizontally
      h2.forEach((n, idx) => {
        const x = startX + idx * (nodeW + hGap);
        const y = 80 + (nodeH + vGap) * 2;
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 1: centered horizontally
      h1.forEach((n) => {
        const x = centerX - nodeW / 2;
        const y = 80 + (nodeH + vGap);
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 0: centered horizontally
      h0.forEach((n) => {
        const x = centerX - nodeW / 2;
        const y = 80;
        nodePositions[n.id] = { ...n, x, y, width: nodeW, height: nodeH };
      });

      // Level 3: below Hop 2
      h3.forEach((n, idx) => {
        const parentLink = effectiveLinks.find(
          (l) => (typeof l.target === "object" ? l.target.id : l.target) === n.id
        );
        let targetX;
        if (
          parentLink &&
          nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source]
        ) {
          targetX =
            nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source].x;
        } else {
          targetX = startX + idx * (nodeW + hGap) * 2;
        }
        const y = 80 + (nodeH + vGap) * 3;
        nodePositions[n.id] = { ...n, x: targetX, y, width: nodeW, height: nodeH };
      });

      // Level 4: below Hop 3
      h4.forEach((n, idx) => {
        const parentLink = effectiveLinks.find(
          (l) => (typeof l.target === "object" ? l.target.id : l.target) === n.id
        );
        let targetX;
        if (
          parentLink &&
          nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source]
        ) {
          targetX =
            nodePositions[typeof parentLink.source === "object" ? parentLink.source.id : parentLink.source].x;
        } else {
          targetX = startX + idx * (nodeW + hGap) * 2;
        }
        const y = 80 + (nodeH + vGap) * 4;
        nodePositions[n.id] = { ...n, x: targetX, y, width: nodeW, height: nodeH };
      });
    }

    // Build branch paths and badges
    const positionedNodes = Object.values(nodePositions);
    const positionedLinks = [];

    effectiveLinks.forEach((l) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      const srcNode = nodePositions[sId];
      const tgtNode = nodePositions[tId];

      if (srcNode && tgtNode) {
        let x1, y1, x2, y2, pathD;

        if (isHorizontal) {
          // Right center of parent -> Left center of child
          x1 = srcNode.x + srcNode.width;
          y1 = srcNode.y + srcNode.height / 2;
          x2 = tgtNode.x;
          y2 = tgtNode.y + tgtNode.height / 2;

          if (branchStyle === "curved") {
            const dx = (x2 - x1) * 0.55;
            pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          } else {
            // Stepped orthogonal pipeline
            const midX = (x1 + x2) / 2;
            const r = Math.min(14, Math.abs(y2 - y1) / 2);
            const signY = y2 > y1 ? 1 : -1;
            if (Math.abs(y1 - y2) < 4) {
              pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
            } else {
              pathD = `M ${x1} ${y1} L ${midX - r} ${y1} Q ${midX} ${y1} ${midX} ${y1 + r * signY} L ${midX} ${y2 - r * signY} Q ${midX} ${y2} ${midX + r} ${y2} L ${x2} ${y2}`;
            }
          }
        } else {
          // Bottom center of parent -> Top center of child
          x1 = srcNode.x + srcNode.width / 2;
          y1 = srcNode.y + srcNode.height;
          x2 = tgtNode.x + tgtNode.width / 2;
          y2 = tgtNode.y;

          if (branchStyle === "curved") {
            const dy = (y2 - y1) * 0.55;
            pathD = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
          } else {
            const midY = (y1 + y2) / 2;
            const r = Math.min(14, Math.abs(x2 - x1) / 2);
            const signX = x2 > x1 ? 1 : -1;
            if (Math.abs(x1 - x2) < 4) {
              pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
            } else {
              pathD = `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 + r * signX} ${midY} L ${x2 - r * signX} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
            }
          }
        }

        positionedLinks.push({
          ...l,
          sourceId: sId,
          targetId: tId,
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

    const maxX = Math.max(...positionedNodes.map((n) => n.x + n.width), 1500) + 120;
    const maxY = Math.max(...positionedNodes.map((n) => n.y + n.height), 900) + 120;

    return {
      positionedNodes,
      positionedLinks,
      canvasBounds: { width: maxX, height: maxY }
    };
  }, [hopGroups, effectiveLinks, treeOrientation, branchStyle]);

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

  // Pan Interactions with strict physical button check (fixes mouse sticking bug)
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".tree-node-card")) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    // If left mouse button is NOT physically held down (e.buttons !== 1), release immediately!
    if (e.buttons !== 1) {
      if (isDragging) setIsDragging(false);
      return;
    }
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // Zoom Interactions
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(0.85);
    setPan({ x: 40, y: 30 });
  };

  const handleFitView = () => {
    if (viewportRef.current) {
      const vWidth = viewportRef.current.clientWidth - 40;
      const cWidth = treeLayout.canvasBounds.width;
      const autoZoom = Math.min(1.0, Math.max(0.45, Number((vWidth / cWidth).toFixed(2))));
      setZoom(autoZoom);
      setPan({ x: 20, y: 20 });
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

  // Active path highlight logic
  const isLinkActive = (l) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    return l.sourceId === activeId || l.targetId === activeId;
  };

  const isNodeActive = (nodeId) => {
    if (!hoveredNodeId && !selectedNode) return true;
    const activeId = hoveredNodeId || selectedNode?.id;
    if (nodeId === activeId) return true;
    return treeLayout.positionedLinks.some(
      (l) => (l.sourceId === activeId && l.targetId === nodeId) || (l.targetId === activeId && l.sourceId === nodeId)
    );
  };

  return (
    <div className="space-y-4 select-none">
      {/* Top Header & Legend */}
      <div className="bg-white border border-[#E8E2D5] rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-serif font-bold text-[#2C2623]">
              Mule Network Horizontal Tree Hierarchy
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#FAF6EE] text-[#D96B27] border border-[#E8E2D5] font-mono flex items-center gap-1">
              <GitBranch className="w-3 h-3 text-[#D96B27]" />
              BRANCHING TREE GRAPH
            </span>
          </div>
          <p className="text-xs text-[#746D65] mt-0.5">
            Dendrogram-style branching graph showing fund fan-out from Victim Root to Terminal Exit leaves with transaction details written on each branch.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs font-semibold">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E6F7F0] border border-[#A7F3D0] text-[#059669]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
            <span>Root: Victim</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFF7ED] border border-[#FFEDD5] text-[#EA580C]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EA580C]"></span>
            <span>Trunk: L1 Collector</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]"></span>
            <span>Branches: L2 Mules</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EDE9FE] border border-[#DDD6FE] text-[#7C3AED]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]"></span>
            <span>Leaves: L3 Terminal</span>
          </div>
        </div>
      </div>

      {/* Toolbar Controls */}
      <div className="bg-[#FAF6EE] border border-[#E8E2D5] rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#746D65] flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-[#D96B27]" />
            Tree Layout:
          </span>

          {/* Orientation Toggle: Horizontal Tree vs Vertical Tree */}
          <div className="flex items-center bg-white border border-[#E8E2D5] rounded-lg overflow-hidden shadow-2xs text-[11px]">
            <button
              onClick={() => setTreeOrientation("horizontal")}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold transition-colors cursor-pointer ${
                treeOrientation === "horizontal" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowRight className="w-3 h-3" />
              <span>Horizontal Tree (Branches)</span>
            </button>
            <button
              onClick={() => setTreeOrientation("vertical")}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold transition-colors cursor-pointer ${
                treeOrientation === "vertical" ? "bg-[#D96B27] text-white" : "hover:bg-[#F3EDE2] text-[#746D65]"
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Vertical Tree</span>
            </button>
          </div>

          {/* Branch Style Toggle: Organic Curved Limbs vs Stepped Pipeline */}
          <button
            onClick={() => setBranchStyle(branchStyle === "curved" ? "orthogonal" : "curved")}
            className="px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all shadow-2xs cursor-pointer bg-white border-[#E8E2D5] text-[#2C2623] hover:bg-[#F3EDE2] flex items-center gap-1"
          >
            <span>{branchStyle === "curved" ? "Tree Limbs (Curved)" : "Circuit Pipes (Orthogonal)"}</span>
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
        onMouseLeave={() => setIsDragging(false)}
        onDragStart={(e) => e.preventDefault()}
        onWheel={handleWheel}
        className={`relative w-full h-[640px] bg-[#FAF7F0] rounded-2xl border-2 border-[#E8E2D5] overflow-hidden shadow-inner select-none ${
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
        {/* TRANSFORMED TREE CANVAS */}
        <div
          className="absolute origin-top-left transition-transform duration-75 ease-out select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: `${treeLayout.canvasBounds.width}px`,
            height: `${treeLayout.canvasBounds.height}px`
          }}
        >
          {/* SVG TREE BRANCHES & LABELS LAYER */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              width: `${treeLayout.canvasBounds.width}px`,
              height: `${treeLayout.canvasBounds.height}px`,
              overflow: "visible"
            }}
          >
            <defs>
              <marker id="tarrow-hop1" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10B981" />
              </marker>
              <marker id="tarrow-hop2" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#EA580C" />
              </marker>
              <marker id="tarrow-hop3" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7C3AED" />
              </marker>
              <marker id="tarrow-hop4" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#E11D48" />
              </marker>
            </defs>

            {/* Tree Branch Connecting Lines */}
            {treeLayout.positionedLinks.map((l, i) => {
              const active = isLinkActive(l);
              const strokeColor = l.hop === 1 ? "#10B981" : l.hop === 2 ? "#EA580C" : l.hop === 3 ? "#7C3AED" : "#E11D48";
              const marker = l.hop === 1 ? "url(#tarrow-hop1)" : l.hop === 2 ? "url(#tarrow-hop2)" : l.hop === 3 ? "url(#tarrow-hop3)" : "url(#tarrow-hop4)";

              return (
                <g key={l.txn_id || i} className="transition-opacity duration-200" opacity={active ? 1.0 : 0.15}>
                  {/* Outer Branch Halo */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 8 : 4}
                    strokeOpacity={active ? 0.22 : 0.1}
                    strokeLinecap="round"
                  />

                  {/* Core Tree Branch Conduit */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={active ? 3 : 2}
                    markerEnd={marker}
                    strokeOpacity={active ? 1.0 : 0.85}
                    strokeLinecap="round"
                  />

                  {/* Directional Fluid Flow Pulse Dash */}
                  <path
                    d={l.pathD}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    strokeDasharray="8,14"
                    strokeOpacity={0.9}
                    strokeLinecap="round"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="44"
                      to="0"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </path>

                  {/* DETAILS WRITTEN DIRECTLY ON THE CONNECTING BRANCH */}
                  <g transform={`translate(${l.midX}, ${l.midY})`} className="pointer-events-auto cursor-pointer">
                    <rect
                      x="-65"
                      y="-11"
                      width="130"
                      height="22"
                      rx="6"
                      fill="#FFFFFF"
                      stroke={strokeColor}
                      strokeWidth={active ? "1.6" : "1.2"}
                      className="shadow-xs"
                    />
                    <text
                      x="0"
                      y="-1"
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="bold"
                      fill="#2C2623"
                      fontFamily="monospace"
                    >
                      ₹{l.amount ? Number(l.amount).toLocaleString("en-IN") : "0"}
                    </text>
                    <text
                      x="0"
                      y="7.5"
                      textAnchor="middle"
                      fontSize="7"
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

          {/* TREE NODES LAYER */}
          {treeLayout.positionedNodes.map((node) => {
            const active = isNodeActive(node.id);
            const isSelected = selectedNode?.id === node.id;
            const isRoot = node.hop === 0;
            const isL1 = node.hop === 1;
            const isL2 = node.hop === 2;
            const isL3 = node.hop === 3;
            const isL4 = (node.hop ?? 0) >= 4;

            const themeColor = isRoot ? "#10B981" : isL1 ? "#EA580C" : isL2 ? "#D97706" : isL3 ? "#7C3AED" : "#E11D48";
            const badgeBg = isRoot ? "#E6F7F0" : isL1 ? "#FFF7ED" : isL2 ? "#FEF3C7" : isL3 ? "#EDE9FE" : "#FFE4E6";

            return (
              <div
                key={node.id}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedNode(node)}
                style={{
                  position: "absolute",
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.width}px`,
                  height: `${node.height}px`
                }}
                className={`tree-node-card bg-white border-2 rounded-xl p-2.5 shadow-sm transition-all duration-150 cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "ring-3 scale-102"
                    : active
                    ? "hover:shadow-md"
                    : "opacity-40 hover:opacity-100"
                }`}
              >
                {/* Port Anchors */}
                {treeOrientation === "horizontal" ? (
                  <>
                    {!isRoot && (
                      <div
                        style={{ backgroundColor: themeColor }}
                        className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-xs"
                      />
                    )}
                    {!isL4 && (
                      <div
                        style={{ backgroundColor: themeColor }}
                        className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-xs"
                      />
                    )}
                  </>
                ) : (
                  <>
                    {!isRoot && (
                      <div
                        style={{ backgroundColor: themeColor }}
                        className="absolute top-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-xs"
                      />
                    )}
                    {!isL4 && (
                      <div
                        style={{ backgroundColor: themeColor }}
                        className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-xs"
                      />
                    )}
                  </>
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
                  <span
                    style={{ backgroundColor: badgeBg, color: themeColor }}
                    className="text-[9px] px-1.5 py-0.2 rounded font-bold font-mono"
                  >
                    {isRoot ? "VICTIM" : isL1 ? "L1 MULE" : isL2 ? `SCORE ${node.risk_score}` : isL3 ? "L3 ESCROW" : "L4 TERMINAL"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#F5EDE1] font-mono">
                  <span className="text-[#746D65] truncate font-sans text-[10px]">
                    {node.bank} ({node.ifsc})
                  </span>
                  <span className="text-[#059669] font-bold">
                    {isRoot
                      ? `Loss: ₹${traceData?.total_siphoned_inr ? Math.round(traceData.total_siphoned_inr).toLocaleString("en-IN") : "0"}`
                      : `Lien: ₹${node.holding_amount ? Math.round(Number(node.holding_amount)).toLocaleString("en-IN") : "0"}`}
                  </span>
                </div>
              </div>
            );
          })}
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
            <span className="font-medium text-[#2C2623]">15-Day Chronological Tree Expansion Replay</span>
          </div>

          <span className="font-mono text-xs text-[#746D65]">
            Temporal Tree: {timeProgress}% ({treeLayout.positionedLinks.length} Active Branches)
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
