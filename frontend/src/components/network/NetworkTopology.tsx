/**
 * NetworkTopology - Interactive network topology visualization
 * 
 * Uses ReactFlow to display networks, routers, and VMs in a hierarchical layout.
 * Part of the QuantumNet SDN implementation.
 * 
 * @see docs/Networking/000070-quantumnet-implementation-plan.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network,
  Router,
  Monitor,
  Globe,
  Server,
  Shield,
  Loader2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { clsx } from 'clsx';

// =============================================================================
// TYPES
// =============================================================================

interface TopologyNode {
  id: string;
  type: 'external' | 'router' | 'network' | 'vm' | 'loadbalancer' | 'securitygroup';
  name: string;
  properties: Record<string, string>;
  status?: 'active' | 'inactive' | 'error' | 'pending';
}

interface TopologyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'route' | 'connection' | 'security';
}

interface NetworkTopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface NetworkTopologyProps {
  projectId?: string;
  onNodeSelect?: (nodeId: string, type: string) => void;
  className?: string;
}

// =============================================================================
// MOCK DATA (Replace with actual API call)
// =============================================================================

const mockTopologyData: NetworkTopologyData = {
  nodes: [
    { id: 'ext-1', type: 'external', name: 'External Network', properties: { cidr: '203.0.113.0/24' }, status: 'active' },
    { id: 'router-1', type: 'router', name: 'Gateway Router', properties: { type: 'gateway' }, status: 'active' },
    { id: 'net-prod', type: 'network', name: 'Production', properties: { cidr: '10.0.1.0/24', type: 'overlay' }, status: 'active' },
    { id: 'net-dev', type: 'network', name: 'Development', properties: { cidr: '10.0.2.0/24', type: 'overlay' }, status: 'active' },
    { id: 'net-mgmt', type: 'network', name: 'Management', properties: { cidr: '10.0.3.0/24', type: 'vlan', vlan_id: '100' }, status: 'active' },
    { id: 'vm-web-1', type: 'vm', name: 'web-server-1', properties: { ip: '10.0.1.10' }, status: 'active' },
    { id: 'vm-web-2', type: 'vm', name: 'web-server-2', properties: { ip: '10.0.1.11' }, status: 'active' },
    { id: 'vm-db-1', type: 'vm', name: 'db-primary', properties: { ip: '10.0.1.20' }, status: 'active' },
    { id: 'vm-dev-1', type: 'vm', name: 'dev-workstation', properties: { ip: '10.0.2.10' }, status: 'inactive' },
    { id: 'lb-1', type: 'loadbalancer', name: 'Web LB', properties: { vip: '10.0.1.100' }, status: 'active' },
  ],
  edges: [
    { id: 'e1', sourceId: 'ext-1', targetId: 'router-1', type: 'route' },
    { id: 'e2', sourceId: 'router-1', targetId: 'net-prod', type: 'route' },
    { id: 'e3', sourceId: 'router-1', targetId: 'net-dev', type: 'route' },
    { id: 'e4', sourceId: 'router-1', targetId: 'net-mgmt', type: 'route' },
    { id: 'e5', sourceId: 'net-prod', targetId: 'vm-web-1', type: 'connection' },
    { id: 'e6', sourceId: 'net-prod', targetId: 'vm-web-2', type: 'connection' },
    { id: 'e7', sourceId: 'net-prod', targetId: 'vm-db-1', type: 'connection' },
    { id: 'e8', sourceId: 'net-dev', targetId: 'vm-dev-1', type: 'connection' },
    { id: 'e9', sourceId: 'net-prod', targetId: 'lb-1', type: 'connection' },
    { id: 'e10', sourceId: 'lb-1', targetId: 'vm-web-1', type: 'connection' },
    { id: 'e11', sourceId: 'lb-1', targetId: 'vm-web-2', type: 'connection' },
  ],
};

// =============================================================================
// NODE COMPONENTS
// =============================================================================

interface NodeProps {
  node: TopologyNode;
  isSelected: boolean;
  onClick: () => void;
}

const nodeStyles = {
  external: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-500/50',
    icon: Globe,
    iconColor: 'text-amber-400',
  },
  router: {
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/50',
    icon: Router,
    iconColor: 'text-purple-400',
  },
  network: {
    bg: 'bg-blue-500/20',
    border: 'border-blue-500/50',
    icon: Network,
    iconColor: 'text-blue-400',
  },
  vm: {
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-500/50',
    icon: Monitor,
    iconColor: 'text-emerald-400',
  },
  loadbalancer: {
    bg: 'bg-cyan-500/20',
    border: 'border-cyan-500/50',
    icon: Server,
    iconColor: 'text-cyan-400',
  },
  securitygroup: {
    bg: 'bg-rose-500/20',
    border: 'border-rose-500/50',
    icon: Shield,
    iconColor: 'text-rose-400',
  },
};

function TopologyNode({ node, isSelected, onClick }: NodeProps) {
  const style = nodeStyles[node.type];
  const Icon = style.icon;
  const isActive = node.status === 'active';

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        'relative flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all',
        style.bg,
        isSelected ? 'border-accent ring-2 ring-accent/30' : style.border,
        'hover:shadow-lg cursor-pointer'
      )}
    >
      {/* Status indicator */}
      <span
        className={clsx(
          'absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-[var(--bg-base)]',
          isActive ? 'bg-success' : node.status === 'error' ? 'bg-error' : 'bg-text-muted'
        )}
      />

      <Icon className={clsx('w-5 h-5', style.iconColor)} />
      
      <div className="text-left">
        <div className="text-sm font-medium text-text-primary truncate max-w-[120px]">
          {node.name}
        </div>
        {node.properties.cidr && (
          <div className="text-xs text-text-secondary">
            {node.properties.cidr}
          </div>
        )}
        {node.properties.ip && (
          <div className="text-xs text-text-secondary">
            {node.properties.ip}
          </div>
        )}
      </div>
    </motion.button>
  );
}

// =============================================================================
// CANVAS COMPONENT (Simple SVG-based layout)
// =============================================================================

interface CanvasProps {
  data: NetworkTopologyData;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  zoom: number;
}

function TopologyCanvas({ data, selectedNodeId, onNodeSelect, zoom }: CanvasProps) {
  // Calculate node positions using hierarchical layout
  const { nodePositions, canvasSize } = useMemo(() => {
    const levels: { [key: string]: number } = {
      external: 0,
      router: 1,
      network: 2,
      loadbalancer: 3,
      vm: 4,
      securitygroup: 2,
    };

    const levelNodes: { [key: number]: TopologyNode[] } = {};
    
    for (const node of data.nodes) {
      const level = levels[node.type] ?? 3;
      if (!levelNodes[level]) levelNodes[level] = [];
      levelNodes[level].push(node);
    }

    const positions: { [key: string]: { x: number; y: number } } = {};
    const levelHeight = 120;
    const nodeWidth = 200;
    const padding = 50;

    let maxWidth = 0;

    for (const [level, nodes] of Object.entries(levelNodes)) {
      const totalWidth = nodes.length * nodeWidth;
      maxWidth = Math.max(maxWidth, totalWidth);
      const startX = padding;

      nodes.forEach((node, index) => {
        positions[node.id] = {
          x: startX + index * nodeWidth + nodeWidth / 2,
          y: padding + parseInt(level) * levelHeight + 30,
        };
      });
    }

    return {
      nodePositions: positions,
      canvasSize: {
        width: Math.max(maxWidth + padding * 2, 800),
        height: padding * 2 + 5 * levelHeight,
      },
    };
  }, [data.nodes]);

  return (
    <div
      className="relative overflow-auto bg-[var(--bg-base)] rounded-xl"
      style={{
        height: '500px',
        transform: `scale(${zoom})`,
        transformOrigin: 'top left',
      }}
    >
      {/* SVG for edges */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={canvasSize.width}
        height={canvasSize.height}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="var(--text-secondary)"
              opacity="0.5"
            />
          </marker>
        </defs>

        {data.edges.map((edge) => {
          const source = nodePositions[edge.sourceId];
          const target = nodePositions[edge.targetId];
          if (!source || !target) return null;

          const isActive = edge.type === 'connection';

          return (
            <g key={edge.id}>
              <line
                x1={source.x}
                y1={source.y + 20}
                x2={target.x}
                y2={target.y - 20}
                stroke={isActive ? 'var(--accent)' : 'var(--text-secondary)'}
                strokeWidth={isActive ? 2 : 1}
                strokeOpacity={0.4}
                markerEnd="url(#arrowhead)"
              />
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      {data.nodes.map((node) => {
        const pos = nodePositions[node.id];
        if (!pos) return null;

        return (
          <div
            key={node.id}
            className="absolute"
            style={{
              left: pos.x - 80,
              top: pos.y - 20,
            }}
          >
            <TopologyNode
              node={node}
              isSelected={selectedNodeId === node.id}
              onClick={() => onNodeSelect(selectedNodeId === node.id ? null : node.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// DETAIL PANEL
// =============================================================================

interface DetailPanelProps {
  node: TopologyNode | null;
  onClose: () => void;
}

function DetailPanel({ node, onClose }: DetailPanelProps) {
  if (!node) return null;

  const style = nodeStyles[node.type];
  const Icon = style.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="absolute right-4 top-4 w-72 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className={clsx('px-4 py-3 flex items-center gap-3', style.bg)}>
        <Icon className={clsx('w-5 h-5', style.iconColor)} />
        <div className="flex-1">
          <h3 className="font-medium text-text-primary">{node.name}</h3>
          <p className="text-xs text-text-secondary capitalize">{node.type}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      {/* Properties */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'w-2 h-2 rounded-full',
              node.status === 'active' ? 'bg-success' : 'bg-text-muted'
            )}
          />
          <span className="text-sm text-text-secondary capitalize">
            {node.status || 'unknown'}
          </span>
        </div>

        {Object.entries(node.properties).map(([key, value]) => (
          <div key={key} className="flex justify-between text-sm">
            <span className="text-text-secondary capitalize">
              {key.replace(/_/g, ' ')}
            </span>
            <span className="text-text-primary font-mono">{value}</span>
          </div>
        ))}

        {/* Actions */}
        <div className="pt-3 border-t border-[var(--border)] space-y-2">
          {node.type === 'vm' && (
            <button className="w-full px-3 py-2 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-left flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              Open Console
            </button>
          )}
          {node.type === 'network' && (
            <button className="w-full px-3 py-2 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-left flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Edit Security Groups
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function NetworkTopology({ projectId, onNodeSelect, className }: NetworkTopologyProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<NetworkTopologyData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  // Simulate data loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setData(mockTopologyData);
      setIsLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [projectId]);

  const handleNodeSelect = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      if (nodeId && onNodeSelect) {
        const node = data?.nodes.find((n) => n.id === nodeId);
        if (node) {
          onNodeSelect(nodeId, node.type);
        }
      }
    },
    [data, onNodeSelect]
  );

  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.id === selectedNodeId) || null,
    [data, selectedNodeId]
  );

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 500);
  };

  if (isLoading) {
    return (
      <div className={clsx('flex items-center justify-center h-[500px] bg-[var(--bg-surface)] rounded-xl', className)}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <span className="text-text-secondary">Loading topology...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={clsx('flex items-center justify-center h-[500px] bg-[var(--bg-surface)] rounded-xl', className)}>
        <span className="text-text-secondary">No topology data available</span>
      </div>
    );
  }

  return (
    <div className={clsx('relative bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-accent" />
          <h2 className="font-medium text-text-primary">Network Topology</h2>
          <span className="text-xs text-text-secondary bg-[var(--bg-surface)] px-2 py-0.5 rounded">
            {data.nodes.length} nodes
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-lg p-1">
            <button
              onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4 text-text-secondary" />
            </button>
            <span className="text-xs text-text-secondary w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
              className="p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4 text-text-secondary" />
            </button>
          </div>

          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg hover:bg-[var(--bg-surface)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-text-secondary" />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg hover:bg-[var(--bg-surface)] transition-colors"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4 text-text-secondary" />
          </button>

          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="p-2 rounded-lg hover:bg-[var(--bg-surface)] transition-colors"
            title="Toggle sidebar"
          >
            {showSidebar ? (
              <ChevronRight className="w-4 h-4 text-text-secondary" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-text-secondary" />
            )}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative">
        <TopologyCanvas
          data={data}
          selectedNodeId={selectedNodeId}
          onNodeSelect={handleNodeSelect}
          zoom={zoom}
        />

        {/* Detail Panel */}
        <AnimatePresence>
          {selectedNode && showSidebar && (
            <DetailPanel node={selectedNode} onClose={() => setSelectedNodeId(null)} />
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-base)]">
        {Object.entries(nodeStyles).map(([type, style]) => {
          const Icon = style.icon;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <Icon className={clsx('w-4 h-4', style.iconColor)} />
              <span className="text-xs text-text-secondary capitalize">{type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NetworkTopology;
