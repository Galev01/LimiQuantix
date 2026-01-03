import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Plus,
  Upload,
  Download,
  RefreshCw,
  Trash2,
  Eye,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  X,
  Lock,
  FileKey,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Certificate {
  id: string;
  name: string;
  domain: string;
  type: 'ssl' | 'ca' | 'client';
  issuer: string;
  validFrom: string;
  validUntil: string;
  status: 'valid' | 'expiring' | 'expired';
  fingerprint: string;
}

export function Certifications() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);

  // Mock certificate data
  const certificates: Certificate[] = [
    {
      id: 'cert-1',
      name: 'Wildcard SSL',
      domain: '*.quantix.local',
      type: 'ssl',
      issuer: 'Let\'s Encrypt',
      validFrom: '2025-01-01',
      validUntil: '2026-01-01',
      status: 'valid',
      fingerprint: 'SHA256:2F:4E:8A:...',
    },
    {
      id: 'cert-2',
      name: 'API Gateway SSL',
      domain: 'api.quantix.local',
      type: 'ssl',
      issuer: 'DigiCert',
      validFrom: '2025-06-01',
      validUntil: '2025-02-15',
      status: 'expiring',
      fingerprint: 'SHA256:9B:3C:1D:...',
    },
    {
      id: 'cert-3',
      name: 'Internal CA Root',
      domain: 'quantix.local',
      type: 'ca',
      issuer: 'Self-Signed',
      validFrom: '2024-01-01',
      validUntil: '2029-01-01',
      status: 'valid',
      fingerprint: 'SHA256:7A:2B:5C:...',
    },
    {
      id: 'cert-4',
      name: 'Legacy API Cert',
      domain: 'legacy.quantix.local',
      type: 'ssl',
      issuer: 'Let\'s Encrypt',
      validFrom: '2024-01-01',
      validUntil: '2025-01-01',
      status: 'expired',
      fingerprint: 'SHA256:1D:4F:9E:...',
    },
    {
      id: 'cert-5',
      name: 'Agent mTLS Client',
      domain: 'agent.quantix.local',
      type: 'client',
      issuer: 'Internal CA',
      validFrom: '2025-01-01',
      validUntil: '2026-01-01',
      status: 'valid',
      fingerprint: 'SHA256:5E:8A:3B:...',
    },
  ];

  const filteredCerts = certificates.filter(
    (cert) =>
      cert.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cert.domain.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const certStats = {
    total: certificates.length,
    valid: certificates.filter((c) => c.status === 'valid').length,
    expiring: certificates.filter((c) => c.status === 'expiring').length,
    expired: certificates.filter((c) => c.status === 'expired').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-accent" />
            Certifications
          </h1>
          <p className="text-text-muted mt-1">
            Manage SSL/TLS certificates, CA certificates, and client certificates
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setShowUploadModal(true)}>
            <Upload className="w-4 h-4" />
            Upload Certificate
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            Request New
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Certificates"
          value={certStats.total}
          icon={<ShieldCheck className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Valid"
          value={certStats.valid}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
        />
        <StatCard
          label="Expiring Soon"
          value={certStats.expiring}
          icon={<Clock className="w-5 h-5" />}
          color="yellow"
        />
        <StatCard
          label="Expired"
          value={certStats.expired}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="red"
        />
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search certificates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input pl-10 w-full"
          />
        </div>
        <select className="form-select w-auto">
          <option value="all">All Types</option>
          <option value="ssl">SSL/TLS</option>
          <option value="ca">CA Certificates</option>
          <option value="client">Client Certificates</option>
        </select>
        <select className="form-select w-auto">
          <option value="all">All Status</option>
          <option value="valid">Valid</option>
          <option value="expiring">Expiring</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Certificate Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl bg-bg-surface border border-border overflow-hidden"
      >
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-bg-base">
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Certificate</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Domain</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Issuer</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Valid Until</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCerts.map((cert) => (
              <tr
                key={cert.id}
                className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-accent/10">
                      <CertTypeIcon type={cert.type} />
                    </div>
                    <span className="font-medium text-text-primary">{cert.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary font-mono text-sm">
                  {cert.domain}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={cert.type === 'ssl' ? 'default' : cert.type === 'ca' ? 'warning' : 'info'}>
                    {cert.type.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary text-sm">
                  {cert.issuer}
                </td>
                <td className="px-4 py-3 text-text-secondary text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-text-muted" />
                    {new Date(cert.validUntil).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={cert.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setSelectedCert(cert)}
                      className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
                      title="Renew"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <UploadCertificateModal onClose={() => setShowUploadModal(false)} />
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedCert && (
          <CertificateDetailModal cert={selectedCert} onClose={() => setSelectedCert(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    yellow: 'bg-warning/10 text-warning',
    red: 'bg-error/10 text-error',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-bg-surface border border-border"
    >
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-sm text-text-muted">{label}</p>
    </motion.div>
  );
}

function CertTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'ssl':
      return <Lock className="w-4 h-4 text-accent" />;
    case 'ca':
      return <FileKey className="w-4 h-4 text-warning" />;
    case 'client':
      return <Globe className="w-4 h-4 text-info" />;
    default:
      return <ShieldCheck className="w-4 h-4 text-text-muted" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
    valid: { variant: 'success', label: 'Valid' },
    expiring: { variant: 'warning', label: 'Expiring Soon' },
    expired: { variant: 'danger', label: 'Expired' },
  };

  const { variant, label } = config[status] || { variant: 'default' as any, label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

function UploadCertificateModal({ onClose }: { onClose: () => void }) {
  const [certType, setCertType] = useState<'ssl' | 'ca' | 'client'>('ssl');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-bg-surface rounded-xl border border-border shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Upload Certificate</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Certificate Type
            </label>
            <div className="flex gap-3">
              {(['ssl', 'ca', 'client'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setCertType(type)}
                  className={cn(
                    'flex-1 p-3 rounded-lg border text-center transition-all',
                    certType === type
                      ? 'bg-accent/10 border-accent text-accent'
                      : 'bg-bg-base border-border text-text-secondary hover:border-border-hover',
                  )}
                >
                  <p className="text-sm font-medium">{type.toUpperCase()}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Certificate Name
            </label>
            <input type="text" className="form-input" placeholder="e.g., Production SSL" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Certificate File (.pem, .crt)
            </label>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer">
              <Upload className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">
                Drag & drop or click to upload
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Private Key File (.key) {certType !== 'ca' && <span className="text-error">*</span>}
            </label>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-accent/50 transition-colors cursor-pointer">
              <Upload className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">
                Drag & drop or click to upload
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            <Upload className="w-4 h-4" />
            Upload Certificate
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CertificateDetailModal({ cert, onClose }: { cert: Certificate; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-bg-surface rounded-xl border border-border shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Certificate Details</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <DetailRow label="Name" value={cert.name} />
          <DetailRow label="Domain" value={cert.domain} mono />
          <DetailRow label="Type" value={cert.type.toUpperCase()} />
          <DetailRow label="Issuer" value={cert.issuer} />
          <DetailRow label="Valid From" value={new Date(cert.validFrom).toLocaleDateString()} />
          <DetailRow label="Valid Until" value={new Date(cert.validUntil).toLocaleDateString()} />
          <DetailRow label="Fingerprint" value={cert.fingerprint} mono />
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Status</span>
            <StatusBadge status={cert.status} />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button variant="secondary">
            <Download className="w-4 h-4" />
            Download
          </Button>
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Renew
          </Button>
          <Button variant="danger">
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm text-text-primary', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

export default Certifications;
