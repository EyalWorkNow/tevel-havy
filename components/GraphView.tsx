import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { GraphData } from '../types';
import { Route, GitMerge, Share2, Network, Globe, Database } from 'lucide-react';

interface GraphViewProps {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
  crossRefEntities?: string[]; // Entities found in other studies
  searchTerm?: string;
  selectedNodeId?: string;
}

const GraphView: React.FC<GraphViewProps> = ({ data, onNodeClick, crossRefEntities = [], searchTerm = '', selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>(['PERSON', 'ORGANIZATION', 'LOCATION', 'ASSET', 'EVENT']);
  
  // "Trace Path" now toggles the Cross-Study Visualization Mode
  const [pathMode, setPathMode] = useState(false);

  const toggleFilter = (type: string) => {
    setActiveFilters(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  useEffect(() => {
    if (!data || !data.nodes || data.nodes.length === 0 || !svgRef.current || !containerRef.current) return;

    // 1. Filter Nodes
    const filteredNodes = data.nodes.filter(n => activeFilters.includes(n.type) || n.type === 'MISC' || n.type === 'HUB');
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
    
    // 2. Prepare Data Clones
    let nodes: any[] = filteredNodes.map(d => ({ ...d }));
    let links: any[] = data.edges
        .filter(e => filteredNodeIds.has(e.source as string) && filteredNodeIds.has(e.target as string))
        .map(d => ({ ...d }));

    // --- LOGIC: TRACE NETWORK (SYNAPSE MODE) ---
    if (pathMode && crossRefEntities.length > 0) {
        const HUB_ID = "TEVEL_SYNAPSE_CORE";
        // Add the Central Intelligence Hub
        nodes.push({
            id: HUB_ID,
            group: 99,
            type: 'HUB',
            x: 0, y: 0,
            fx: null, fy: null // Allow it to float but heavily tethered
        });

        // Link active entities to the Hub
        crossRefEntities.forEach(entityId => {
            if (filteredNodeIds.has(entityId)) {
                links.push({
                    source: entityId,
                    target: HUB_ID,
                    value: 2,
                    isExternal: true,
                    id: `link_${entityId}_hub`
                });
            }
        });
    }

    // --- VISUAL STATE LOGIC ---
    const lowerSearchTerm = searchTerm.toLowerCase();
    const isSearching = searchTerm.trim().length > 0;
    const isFocusMode = !!selectedNodeId;
    const highlightNodeIds = new Set<string>();
    
    if (isSearching) {
        nodes.forEach(n => { if (n.id.toLowerCase().includes(lowerSearchTerm)) highlightNodeIds.add(n.id); });
        links.forEach(e => {
            if (highlightNodeIds.has(e.source as string) || highlightNodeIds.has(e.target as string)) {
                 highlightNodeIds.add(e.source as string);
                 highlightNodeIds.add(e.target as string);
            }
        });
    }

    if (isFocusMode) {
        highlightNodeIds.add(selectedNodeId);
        links.forEach(e => {
            if (e.source === selectedNodeId) highlightNodeIds.add(e.target as string);
            if (e.target === selectedNodeId) highlightNodeIds.add(e.source as string);
        });
    }

    const isLargeGraph = nodes.length > 160;

    // Track simulation for cleanup
    let simulation: d3.Simulation<d3.SimulationNodeDatum, undefined> | null = null;

    // --- RENDER FUNCTION ---
    const updateGraph = () => {
        if (!containerRef.current || !svgRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        // Cleanup old simulation if exists
        if (simulation) simulation.stop();

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        
        // --- DEFINITIONS (Gradients & Filters) ---
        const defs = svg.append("defs");

        // Glow Filter
        const filter = defs.append("filter")
            .attr("id", "glow")
            .attr("x", "-50%")
            .attr("y", "-50%")
            .attr("width", "200%")
            .attr("height", "200%");
        filter.append("feGaussianBlur")
            .attr("stdDeviation", "2.5")
            .attr("result", "coloredBlur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // Entity Gradients
        const entityColors: Record<string, string> = {
            'PERSON': '#f43f5e',      // Rose
            'ORGANIZATION': '#0ea5e9',// Sky
            'LOCATION': '#10b981',    // Emerald
            'ASSET': '#f59e0b',       // Amber
            'EVENT': '#a855f7',       // Purple
            'MISC': '#64748b',        // Slate
            'HUB': '#f59e0b'          // Amber (Synapse Core)
        };

        Object.entries(entityColors).forEach(([type, color]) => {
            const gradient = defs.append("radialGradient")
                .attr("id", `grad-${type}`)
                .attr("cx", "50%")
                .attr("cy", "50%")
                .attr("r", "50%");
            gradient.append("stop").attr("offset", "0%").attr("stop-color", d3.color(color)?.brighter(1.5)?.toString() || "#fff");
            gradient.append("stop").attr("offset", "100%").attr("stop-color", color);
        });

        // Synapse Core Gradient
        const hubGrad = defs.append("radialGradient")
            .attr("id", "grad-HUB-CORE")
            .attr("cx", "50%")
            .attr("cy", "50%")
            .attr("r", "50%");
        hubGrad.append("stop").attr("offset", "0%").attr("stop-color", "#fbbf24"); // Amber-400
        hubGrad.append("stop").attr("offset", "80%").attr("stop-color", "#b45309"); // Amber-700
        hubGrad.append("stop").attr("offset", "100%").attr("stop-color", "rgba(0,0,0,0.5)");

        const g = svg.append("g");
        const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (event) => g.attr("transform", event.transform));
        svg.call(zoom as any);

        // Simulation Setup
        simulation = d3.forceSimulation(nodes)
          .force("link", d3.forceLink(links).id((d: any) => d.id).distance((d: any) => {
            if (d.isExternal) return isLargeGraph ? 100 : 150;
            return isLargeGraph ? 52 : 80;
          }))
          // Stronger center pull if pathMode is active to cluster around the core
          .force("charge", d3.forceManyBody().strength((d: any) => {
            if (d.type === 'HUB') return -2000;
            return isLargeGraph ? -180 : -400;
          }))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collide", d3.forceCollide().radius((d: any) => {
            if (d.type === 'HUB') return 80;
            return isLargeGraph ? 20 : 35;
          }));

        // Links
        const link = g.append("g")
          .selectAll("line")
          .data(links)
          .join("line")
          .attr("stroke", (d: any) => d.isExternal ? "#f59e0b" : "#334155")
          .attr("stroke-dasharray", (d: any) => d.isExternal ? "6,4" : "none")
          .attr("stroke-width", (d: any) => d.isExternal ? 2 : Math.sqrt(d.value || 1))
          .attr("class", (d: any) => d.isExternal ? "synapse-link" : "") // Class for CSS animation
          .attr("stroke-opacity", (d: any) => {
              if (pathMode) return d.isExternal ? 0.8 : 0.1; // Dim internal links in path mode
              if (isFocusMode) return (d.source.id === selectedNodeId || d.target.id === selectedNodeId) ? 0.6 : 0.1;
              if (isSearching) return (highlightNodeIds.has(d.source.id) || highlightNodeIds.has(d.target.id)) ? 0.6 : 0.1;
              return 0.3;
          });

        // Add CSS for flow animation via style tag injection
        svg.append("style").text(`
            @keyframes flow {
                to { stroke-dashoffset: -20; }
            }
            .synapse-link {
                animation: flow 1s linear infinite;
            }
            @keyframes pulse-ring {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(1.5); opacity: 0; }
            }
        `);

        // Nodes Container
        const node = g.append("g")
          .selectAll("g")
          .data(nodes)
          .join("g")
          .attr("cursor", "pointer")
          .call(drag(simulation) as any)
          .on("click", (event, d: any) => {
            event.stopPropagation();
            if (d.type !== 'HUB') onNodeClick(d.id);
          });

        const getRadius = (d: any) => {
            if (d.type === 'HUB') return 40;
            const count = links.filter((l: any) => l.source.id === d.id || l.target.id === d.id).length;
            return 14 + Math.min(count * 2, 20) + (d.id === selectedNodeId ? 5 : 0);
        };

        // --- NODE VISUALS ---

        // 1. Synapse Hub Special Visuals
        const hubNodes = node.filter((d: any) => d.type === 'HUB');
        
        // Pulsing Rings for Hub
        hubNodes.append("circle")
            .attr("r", 50)
            .attr("fill", "none")
            .attr("stroke", "#f59e0b")
            .attr("stroke-opacity", 0.3)
            .attr("stroke-width", 1)
            .attr("class", "animate-[spin_10s_linear_infinite]");
            
        hubNodes.append("circle")
            .attr("r", 40)
            .attr("fill", "url(#grad-HUB-CORE)")
            .style("filter", "url(#glow)");

        // 2. Gateway Nodes (Bridge Entities) Special Visuals
        // If an entity is in crossRefEntities, it gets a special "Bridge" indicator
        const gatewayNodes = node.filter((d: any) => crossRefEntities.includes(d.id));
        
        // Rotating "Radar" border for Gateways
        gatewayNodes.append("circle")
            .attr("r", (d: any) => getRadius(d) + 8)
            .attr("fill", "none")
            .attr("stroke", "#f59e0b")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "3, 6") // Dotted radar look
            .attr("stroke-opacity", 0.8)
            .attr("class", "animate-[spin_4s_linear_infinite]");

        // 3. Standard Node Body
        node.filter((d: any) => d.type !== 'HUB')
          .append("circle")
          .attr("r", (d: any) => getRadius(d))
          .attr("fill", (d: any) => `url(#grad-${entityColors[d.type] ? d.type : 'MISC'})`)
          .attr("stroke", (d: any) => d.id === selectedNodeId ? "#fff" : "rgba(255,255,255,0.1)")
          .attr("stroke-width", (d: any) => d.id === selectedNodeId ? 2 : 1)
          .style("filter", (d: any) => (d.id === selectedNodeId || crossRefEntities.includes(d.id)) ? "url(#glow)" : null)
          .attr("opacity", (d: any) => {
              if (pathMode) return (crossRefEntities.includes(d.id)) ? 1 : 0.15; // Fade others significantly
              if (isFocusMode && !highlightNodeIds.has(d.id)) return 0.2;
              if (isSearching && !highlightNodeIds.has(d.id)) return 0.2;
              return 1;
          });

        // 4. Icons / Inner Detail
        // Add a "Link" icon to gateway nodes
        gatewayNodes.append("text")
            .attr("font-family", "Heebo, sans-serif") 
            .attr("text-anchor", "middle")
            .attr("dy", (d: any) => -(getRadius(d) + 5)) // FIXED: properly use callback with getRadius
            .text("⚡")
            .attr("font-size", 10);

        // HUB Label
        hubNodes.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", 5)
            .attr("fill", "#fff")
            .style("font-size", "10px")
            .style("font-weight", "900")
            .style("text-shadow", "0px 0px 4px #000")
            .text("TEVEL NET");

        hubNodes.append("text")
            .attr("text-anchor", "middle")
            .attr("dy", 18)
            .attr("fill", "#fcd34d") // lighter amber
            .style("font-size", "8px")
            .style("font-family", "Heebo, sans-serif")
            .text(`${crossRefEntities.length} LINKS ACTIVE`);

        // Standard Labels
        const labelNodes = node.filter((d: any) => {
          if (d.type === 'HUB') return false;
          if (!isLargeGraph) return true;
          return crossRefEntities.includes(d.id) || highlightNodeIds.has(d.id) || d.id === selectedNodeId;
        });

        labelNodes
          .append("text")
          .attr("x", (d: any) => getRadius(d) + 10)
          .attr("y", 5)
          .text((d: any) => d.id.length > 20 ? d.id.substring(0, 18) + '...' : d.id)
          .style("font-size", "11px")
          .style("font-family", "Heebo, sans-serif") 
          .style("font-weight", "600")
          .style("pointer-events", "none")
          .style("paint-order", "stroke")
          .attr("stroke", "#09090b")
          .attr("stroke-width", "3px")
          .attr("stroke-linejoin", "round")
          .attr("fill", (d: any) => {
              if (crossRefEntities.includes(d.id)) return '#f59e0b'; // Amber text for bridges
              return (d.id === selectedNodeId) ? '#05DF9C' : '#e2e8f0';
          })
          .attr("opacity", (d: any) => {
              if (pathMode) return crossRefEntities.includes(d.id) ? 1 : 0.1;
              if (isFocusMode && !highlightNodeIds.has(d.id)) return 0.1;
              if (isSearching && !highlightNodeIds.has(d.id)) return 0.1;
              return 1;
          });

        simulation.on("tick", () => {
          link
            .attr("x1", (d: any) => d.source.x)
            .attr("y1", (d: any) => d.source.y)
            .attr("x2", (d: any) => d.target.x)
            .attr("y2", (d: any) => d.target.y);
          node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
        });

        function drag(simulation: any) {
          function dragstarted(event: any) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
          }
          function dragged(event: any) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          }
          function dragended(event: any) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
          }
          return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
        }
    };

    // Initial call
    updateGraph();

    // Resize handling
    const observer = new ResizeObserver(() => updateGraph());
    if (containerRef.current) observer.observe(containerRef.current);
    
    return () => {
        observer.disconnect();
        if (simulation) simulation.stop();
    };

  }, [data, activeFilters, pathMode, crossRefEntities, searchTerm, selectedNodeId]);

  const filters = [
      { id: 'PERSON', color: '#f43f5e', label: 'People' },
      { id: 'ORGANIZATION', color: '#0ea5e9', label: 'Orgs' },
      { id: 'LOCATION', color: '#10b981', label: 'Locations' },
      { id: 'ASSET', color: '#f59e0b', label: 'Assets' }
  ];

  return (
    <div ref={containerRef} className="w-full h-full bg-[#121212]/50 rounded-lg overflow-hidden border border-slate-700/50 shadow-inner relative group">
      <svg ref={svgRef} className="w-full h-full block touch-none"></svg>
      
      {/* Legend */}
      <div className="absolute top-4 left-4 flex flex-col gap-2">
          {filters.map(f => (
              <button 
                key={f.id}
                onClick={() => toggleFilter(f.id)}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs border transition-all ${activeFilters.includes(f.id) ? 'bg-slate-900/80 border-slate-600 text-slate-200' : 'bg-slate-900/30 border-transparent text-slate-500 opacity-60'}`}
              >
                  <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: f.color }}></div>
                  {f.label}
              </button>
          ))}
          {/* Legend for Cross-Ref */}
          {crossRefEntities.length > 0 && (
              <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs border bg-amber-900/30 border-amber-500/30 text-amber-500 transition-opacity ${pathMode ? 'opacity-100' : 'opacity-70'}`}>
                  <div className="w-2 h-2 rounded-full border border-amber-500 bg-transparent animate-[spin_4s_linear_infinite]" style={{borderStyle: 'dashed'}}></div>
                  External Links
              </div>
          )}
      </div>

      {/* New Trace Network Control */}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
          <button 
             onClick={() => setPathMode(!pathMode)}
             className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-xl transition-all
                ${pathMode 
                    ? 'bg-amber-500 text-black border-amber-400 animate-pulse shadow-[0_0_15px_#f59e0b]' 
                    : 'bg-slate-800 text-slate-400 border-slate-600 hover:text-white'}
             `}
          >
             {pathMode ? <Database size={14} /> : <Share2 size={14} />} 
             {pathMode ? 'NETWORK ACTIVE' : 'TRACE NETWORK'}
          </button>
          
          {pathMode && (
              <div className="bg-black/80 backdrop-blur border border-amber-500/50 p-2 rounded text-xs text-amber-400 font-mono">
                  {crossRefEntities.length > 0 
                    ? `>> ${crossRefEntities.length} BRIDGES DETECTED` 
                    : ">> NO EXTERNAL LINKS FOUND"}
              </div>
          )}
      </div>

      <div className="absolute bottom-4 left-4 text-xs text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-black/50 px-2 py-1 rounded">
        Scroll to Zoom • Drag to Pan
      </div>
    </div>
  );
};

export default GraphView;
