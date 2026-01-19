import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera, 
  ChevronRight, 
  ChevronDown, 
  RotateCcw, 
  Trash2, 
  Clock, 
  MemoryStick,
  FileCheck,
  Loader2,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { type ApiSnapshot, formatSnapshotSize } from '@/hooks/useSnapshots';

interface SnapshotTreeProps {
  snapshots: ApiSnapshot[];
  onRevert: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
  isActionPending: boolean;
  vmState: string;
}

interface TreeNode {
  snapshot: ApiSnapshot;
  children: TreeNode[];
  depth: number;
}

// Build tree structure from flat snapshot list
function buildSnapshotTree(snapshots: ApiSnapshot[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes for all snapshots
  for (const snapshot of snapshots) {
    nodeMap.set(snapshot.id, {
      snapshot,
      children: [],
      depth: 0,
    });
  }

  // Build parent-child relationships
  for (const snapshot of snapshots) {
    const node = nodeMap.get(snapshot.id)!;
    if (snapshot.parentId && nodeMap.has(snapshot.parentId)) {
      const parent = nodeMap.get(snapshot.parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Calculate depths
  function setDepth(node: TreeNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }

  for (const root of roots) {
    setDepth(root, 0);
  }

  // Sort by creation date (oldest first)
  function sortByDate(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      const dateA = a.snapshot.createdAt ? new Date(a.snapshot.createdAt).getTime() : 0;
      const dateB = b.snapshot.createdAt ? new Date(b.snapshot.createdAt).getTime() : 0;
      return dateA - dateB;
    });
    for (const node of nodes) {
      sortByDate(node.children);
    }
  }

  sortByDate(roots);

  return roots;
}

// Flatten tree for rendering with proper indentation
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  
  function traverse(node: TreeNode) {
    result.push(node);
    for (const child of node.children) {
      traverse(child);
    }
  }
  
  for (const root of nodes) {
    traverse(root);
  }
  
  return result;
}

export function SnapshotTree({
  snapshots,
  onRevert,
  onDelete,
  isActionPending,
  vmState,
}: SnapshotTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Build and flatten tree
  const tree = useMemo(() => buildSnapshotTree(snapshots), [snapshots]);
  const flatNodes = useMemo(() => flattenTree(tree), [tree]);

  // Auto-expand all nodes by default
  useMemo(() => {
    const allIds = new Set(snapshots.map(s => s.id));
    setExpandedNodes(allIds);
  }, [snapshots]);

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Check if a node should be visible (all ancestors expanded)
  const isVisible = (node: TreeNode): boolean => {
    if (node.depth === 0) return true;
    
    // Find parent
    const parent = snapshots.find(s => s.id === node.snapshot.parentId);
    if (!parent) return true;
    
    return expandedNodes.has(parent.id);
  };

  // Check if a node has children
  const hasChildren = (node: TreeNode): boolean => node.children.length > 0;

  return (
    <div className="space-y-1">
      {/* Tree Header */}
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
        <GitBranch className="w-4 h-4" />
        <span>Snapshot Tree</span>
        <span className="text-text-muted/50">({snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''})</span>
      </div>

      {/* Tree Nodes */}
      <AnimatePresence mode="popLayout">
        {flatNodes.map((node) => {
          if (!isVisible(node)) return null;

          return (
            <SnapshotTreeNode
              key={node.snapshot.id}
              node={node}
              isExpanded={expandedNodes.has(node.snapshot.id)}
              hasChildren={hasChildren(node)}
              onToggle={() => toggleExpand(node.snapshot.id)}
              onRevert={() => onRevert(node.snapshot.id)}
              onDelete={() => onDelete(node.snapshot.id)}
              isActionPending={isActionPending}
              vmState={vmState}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

interface SnapshotTreeNodeProps {
  node: TreeNode;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onRevert: () => void;
  onDelete: () => void;
  isActionPending: boolean;
  vmState: string;
}

function SnapshotTreeNode({
  node,
  isExpanded,
  hasChildren,
  onToggle,
  onRevert,
  onDelete,
  isActionPending,
  vmState,
}: SnapshotTreeNodeProps) {
  const { snapshot, depth } = node;
  const createdDate = snapshot.createdAt ? new Date(snapshot.createdAt) : null;
  const canRevert = vmState !== 'RUNNING' || snapshot.memoryIncluded;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group px-4 py-3 hover:bg-bg-hover transition-colors',
        depth > 0 && 'border-l-2 border-border ml-4'
      )}
      style={{ paddingLeft: `${16 + depth * 24}px` }}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Expand + Icon + Info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Expand/Collapse Button */}
          <button
            onClick={onToggle}
            disabled={!hasChildren}
            className={cn(
              'p-1 rounded transition-colors',
              hasChildren 
                ? 'hover:bg-bg-base text-text-muted hover:text-text-primary' 
                : 'text-transparent cursor-default'
            )}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )
            ) : (
              <div className="w-4 h-4" />
            )}
          </button>

          {/* Snapshot Icon */}
          <div className={cn(
            'p-2 rounded-lg transition-colors',
            depth === 0 ? 'bg-accent/20' : 'bg-bg-base border border-border'
          )}>
            <Camera className={cn(
              'w-4 h-4',
              depth === 0 ? 'text-accent' : 'text-text-muted'
            )} />
          </div>

          {/* Snapshot Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-text-primary truncate">
                {snapshot.name}
              </h4>
              {snapshot.memoryIncluded && (
                <Badge variant="default" size="sm" className="flex items-center gap-1">
                  <MemoryStick className="w-3 h-3" />
                  Memory
                </Badge>
              )}
              {snapshot.quiesced && (
                <Badge variant="default" size="sm" className="flex items-center gap-1">
                  <FileCheck className="w-3 h-3" />
                  Quiesced
                </Badge>
              )}
              {depth === 0 && (
                <Badge variant="default" size="sm" className="bg-accent/10 text-accent border-accent/30">
                  Root
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-text-muted">
              {snapshot.description && (
                <span className="truncate max-w-xs">{snapshot.description}</span>
              )}
              {createdDate && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Clock className="w-3 h-3" />
                  {createdDate.toLocaleDateString()} {createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="whitespace-nowrap">{formatSnapshotSize(snapshot.sizeBytes)}</span>
              {hasChildren && (
                <span className="text-accent whitespace-nowrap">
                  {node.children.length} child{node.children.length !== 1 ? 'ren' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRevert}
            disabled={isActionPending || !canRevert}
            title={!canRevert ? 'Stop VM to revert to disk-only snapshot' : 'Revert to this snapshot'}
          >
            <RotateCcw className="w-4 h-4" />
            Revert
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isActionPending}
            className="text-error hover:text-error hover:bg-error/10"
            title={hasChildren ? 'Cannot delete snapshot with children' : 'Delete snapshot'}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// Simple flat list view as an alternative
export function SnapshotList({
  snapshots,
  onRevert,
  onDelete,
  isActionPending,
  vmState,
}: SnapshotTreeProps) {
  return (
    <div className="divide-y divide-border">
      {snapshots.map((snapshot) => (
        <SnapshotListItem
          key={snapshot.id}
          snapshot={snapshot}
          onRevert={() => onRevert(snapshot.id)}
          onDelete={() => onDelete(snapshot.id)}
          isActionPending={isActionPending}
          vmState={vmState}
        />
      ))}
    </div>
  );
}

function SnapshotListItem({
  snapshot,
  onRevert,
  onDelete,
  isActionPending,
  vmState,
}: {
  snapshot: ApiSnapshot;
  onRevert: () => void;
  onDelete: () => void;
  isActionPending: boolean;
  vmState: string;
}) {
  const createdDate = snapshot.createdAt ? new Date(snapshot.createdAt) : null;
  const canRevert = vmState !== 'RUNNING' || snapshot.memoryIncluded;

  return (
    <div className="px-6 py-4 hover:bg-bg-hover transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-bg-base border border-border">
            <Camera className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-text-primary truncate">{snapshot.name}</h4>
              {snapshot.memoryIncluded && (
                <Badge variant="default" size="sm">Memory</Badge>
              )}
              {snapshot.quiesced && (
                <Badge variant="default" size="sm">Quiesced</Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-text-muted">
              {snapshot.description && (
                <span className="truncate max-w-xs">{snapshot.description}</span>
              )}
              {createdDate && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Clock className="w-3 h-3" />
                  {createdDate.toLocaleDateString()} {createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="whitespace-nowrap">{formatSnapshotSize(snapshot.sizeBytes)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRevert}
            disabled={isActionPending || !canRevert}
            title={!canRevert ? 'Stop VM to revert to disk-only snapshot' : 'Revert to this snapshot'}
          >
            <RotateCcw className="w-4 h-4" />
            Revert
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isActionPending}
            className="text-error hover:text-error hover:bg-error/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
