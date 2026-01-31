/**
 * Packet Trace Modal - UI for running ovn-trace to debug network flows
 */

import { useState } from 'react';
import { X, Play, AlertTriangle, CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import { Card, Input, Label } from '@/components/ui';

interface PacketTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TraceHop {
  pipeline: string;
  tableName: string;
  priority: number;
  actions: string;
  isDrop: boolean;
}

interface TraceResult {
  output: string;
  hops: TraceHop[];
  verdict: string;
  dropReason?: string;
  dropped: boolean;
  durationMs: number;
}

export function PacketTraceModal({ isOpen, onClose }: PacketTraceModalProps) {
  const [inPort, setInPort] = useState('');
  const [srcIP, setSrcIP] = useState('');
  const [dstIP, setDstIP] = useState('');
  const [protocol, setProtocol] = useState('tcp');
  const [srcPort, setSrcPort] = useState('');
  const [dstPort, setDstPort] = useState('80');
  const [isTracing, setIsTracing] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);

  const handleTrace = async () => {
    setIsTracing(true);
    setResult(null);

    // Simulate trace - in production this would call the backend API
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mock result
    const mockResult: TraceResult = {
      output: `# ovn-trace example output
ingress(ls=switch1)
1. ls_in_port_sec_l2: check_port_sec_allow
2. ls_in_pre_acl: 0 (ct.est), actions=next
3. ls_in_acl: priority=2001, actions=ct_commit(ct_mark=0)
4. ls_in_l2_lkup: priority=50, output
egress(ls=switch1)
5. ls_out_pre_acl: priority=0
6. ls_out_acl: priority=2001, allow
7. ls_out_port_sec_l2: check_port_sec`,
      hops: [
        { pipeline: 'ingress', tableName: 'ls_in_port_sec_l2', priority: 0, actions: 'next', isDrop: false },
        { pipeline: 'ingress', tableName: 'ls_in_pre_acl', priority: 0, actions: 'next', isDrop: false },
        { pipeline: 'ingress', tableName: 'ls_in_acl', priority: 2001, actions: 'ct_commit', isDrop: false },
        { pipeline: 'ingress', tableName: 'ls_in_l2_lkup', priority: 50, actions: 'output', isDrop: false },
        { pipeline: 'egress', tableName: 'ls_out_pre_acl', priority: 0, actions: 'next', isDrop: false },
        { pipeline: 'egress', tableName: 'ls_out_acl', priority: 2001, actions: 'allow', isDrop: false },
        { pipeline: 'egress', tableName: 'ls_out_port_sec_l2', priority: 0, actions: 'output', isDrop: false },
      ],
      verdict: 'allow',
      dropped: false,
      durationMs: 45,
    };

    setResult(mockResult);
    setIsTracing(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Packet Trace</h2>
            <p className="text-sm text-text-muted">Debug network flows using ovn-trace</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-bg-elevated rounded-lg transition-colors">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 border-b border-border-default space-y-4 bg-bg-base">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Ingress Port</Label>
              <Input
                placeholder="e.g., vm-port-1"
                value={inPort}
                onChange={(e) => setInPort(e.target.value)}
              />
            </div>
            <div>
              <Label>Protocol</Label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                className="w-full px-3 py-2 bg-bg-surface border border-border-default rounded-lg text-text-primary"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Source IP</Label>
              <Input
                placeholder="e.g., 10.0.0.5"
                value={srcIP}
                onChange={(e) => setSrcIP(e.target.value)}
              />
            </div>
            <div>
              <Label>Destination IP</Label>
              <Input
                placeholder="e.g., 10.0.0.10"
                value={dstIP}
                onChange={(e) => setDstIP(e.target.value)}
              />
            </div>
          </div>

          {protocol !== 'icmp' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Source Port</Label>
                <Input
                  placeholder="e.g., 49152"
                  value={srcPort}
                  onChange={(e) => setSrcPort(e.target.value)}
                />
              </div>
              <div>
                <Label>Destination Port</Label>
                <Input
                  placeholder="e.g., 80"
                  value={dstPort}
                  onChange={(e) => setDstPort(e.target.value)}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleTrace}
            disabled={isTracing || !srcIP || !dstIP}
            className="w-full px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTracing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Tracing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Trace
              </>
            )}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto p-4">
          {result && (
            <div className="space-y-4">
              {/* Verdict */}
              <div
                className={`p-4 rounded-lg flex items-center gap-3 ${
                  result.dropped
                    ? 'bg-red-500/10 border border-red-500/20'
                    : 'bg-green-500/10 border border-green-500/20'
                }`}
              >
                {result.dropped ? (
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                ) : (
                  <CheckCircle className="w-6 h-6 text-green-400" />
                )}
                <div>
                  <div className={`font-semibold ${result.dropped ? 'text-red-400' : 'text-green-400'}`}>
                    {result.verdict.toUpperCase()}
                  </div>
                  <div className="text-sm text-text-muted">
                    {result.dropped
                      ? result.dropReason || 'Packet dropped by ACL or policy'
                      : `Packet allowed (${result.durationMs}ms)`}
                  </div>
                </div>
              </div>

              {/* Hop Visualization */}
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-text-primary mb-2">Packet Flow</h3>
                {result.hops.map((hop, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-2 px-3 py-2 rounded ${
                      hop.isDrop ? 'bg-red-500/10' : 'bg-bg-surface'
                    }`}
                  >
                    <ChevronRight className={`w-4 h-4 ${hop.isDrop ? 'text-red-400' : 'text-text-muted'}`} />
                    <span className="text-xs px-2 py-0.5 bg-bg-elevated rounded text-text-muted">
                      {hop.pipeline}
                    </span>
                    <span className="font-mono text-sm text-text-primary">{hop.tableName}</span>
                    <span className="text-xs text-text-muted">priority {hop.priority}</span>
                    <span className="flex-1" />
                    <span className={`text-xs ${hop.isDrop ? 'text-red-400' : 'text-neonBlue'}`}>
                      {hop.actions}
                    </span>
                  </div>
                ))}
              </div>

              {/* Raw Output Toggle */}
              <div>
                <button
                  onClick={() => setShowRawOutput(!showRawOutput)}
                  className="text-sm text-neonBlue hover:underline"
                >
                  {showRawOutput ? 'Hide' : 'Show'} raw output
                </button>
                {showRawOutput && (
                  <pre className="mt-2 p-4 bg-bg-base rounded-lg text-xs text-text-muted overflow-x-auto font-mono">
                    {result.output}
                  </pre>
                )}
              </div>
            </div>
          )}

          {!result && !isTracing && (
            <div className="text-center text-text-muted py-8">
              Enter packet details above and click "Run Trace" to debug network flows
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
