import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  Disc,
  Package,
  FileUp,
  Info,
  CheckCircle,
  Loader2,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ISOUploadDialog, OVAUploadModal } from '@/components/storage';
import { useOVATemplates, formatOVASize } from '@/hooks/useOVA';

type UploadType = 'iso' | 'ova';

const SUPPORTED_FORMATS = {
  iso: {
    extensions: ['.iso'],
    maxSize: '50 GB',
    description: 'Standard ISO 9660 disc images for OS installation',
    icon: Disc,
    color: 'warning',
  },
  ova: {
    extensions: ['.ova', '.ovf'],
    maxSize: '100 GB',
    description: 'Open Virtual Appliance templates with pre-configured VMs',
    icon: Package,
    color: 'info',
  },
};

export function UploadsPage() {
  const [isISOUploadOpen, setIsISOUploadOpen] = useState(false);
  const [isOVAUploadOpen, setIsOVAUploadOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<UploadType | null>(null);

  const { data: ovaTemplates, refetch: refetchOVA } = useOVATemplates();

  const handleTypeSelect = (type: UploadType) => {
    setSelectedType(type);
    if (type === 'iso') {
      setIsISOUploadOpen(true);
    } else {
      setIsOVAUploadOpen(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-info/10 border border-info/30">
        <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-info">Upload Images & Templates</p>
          <p className="text-xs text-text-muted mt-1">
            Upload ISO files for manual OS installations or OVA templates for pre-configured virtual appliances.
            Uploads are stored in your configured storage pool and automatically indexed.
          </p>
        </div>
      </div>

      {/* Upload Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ISO Upload Card */}
        <motion.div
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => handleTypeSelect('iso')}
          className={cn(
            'p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
            'bg-bg-surface hover:border-warning/50 hover:bg-warning/5',
            selectedType === 'iso' ? 'border-warning bg-warning/5' : 'border-border'
          )}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mb-4">
              <Disc className="w-8 h-8 text-warning" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary">Upload ISO</h3>
            <p className="text-sm text-text-muted mt-2">
              Upload ISO disc images for manual OS installations
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Badge variant="default" size="sm">.iso</Badge>
              <span className="text-xs text-text-muted">Up to 50 GB</span>
            </div>
            <Button variant="secondary" className="mt-4">
              <Upload className="w-4 h-4" />
              Select ISO File
            </Button>
          </div>
        </motion.div>

        {/* OVA Upload Card */}
        <motion.div
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => handleTypeSelect('ova')}
          className={cn(
            'p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
            'bg-bg-surface hover:border-info/50 hover:bg-info/5',
            selectedType === 'ova' ? 'border-info bg-info/5' : 'border-border'
          )}
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-info/10 flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-info" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary">Upload OVA</h3>
            <p className="text-sm text-text-muted mt-2">
              Import OVA/OVF templates with pre-configured VMs
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Badge variant="default" size="sm">.ova</Badge>
              <Badge variant="default" size="sm">.ovf</Badge>
              <span className="text-xs text-text-muted">Up to 100 GB</span>
            </div>
            <Button variant="secondary" className="mt-4">
              <Upload className="w-4 h-4" />
              Select OVA File
            </Button>
          </div>
        </motion.div>
      </div>

      {/* Supported Formats Table */}
      <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text-primary">Supported File Types</h3>
        </div>
        <table className="w-full">
          <thead className="bg-bg-base">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Type</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Extensions</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Max Size</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-muted">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Disc className="w-4 h-4 text-warning" />
                  <span className="text-sm text-text-primary">ISO Image</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant="default" size="sm">.iso</Badge>
              </td>
              <td className="px-4 py-3 text-sm text-text-muted">50 GB</td>
              <td className="px-4 py-3 text-sm text-text-muted">Standard disc images</td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-info" />
                  <span className="text-sm text-text-primary">OVA Template</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  <Badge variant="default" size="sm">.ova</Badge>
                  <Badge variant="default" size="sm">.ovf</Badge>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-text-muted">100 GB</td>
              <td className="px-4 py-3 text-sm text-text-muted">Virtual appliance templates</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Recent Uploads */}
      {ovaTemplates && ovaTemplates.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-primary">Recent OVA Uploads</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ovaTemplates.slice(0, 6).map((template) => (
              <div
                key={template.id}
                className="p-4 rounded-xl bg-bg-surface border border-border"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-info" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{template.name}</p>
                      <CheckCircle className="w-4 h-4 text-success shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                      <span>{formatOVASize(template.status?.virtualSizeBytes || 0)}</span>
                      {template.spec?.os?.distribution && (
                        <>
                          <span>•</span>
                          <span className="capitalize">{template.spec.os.distribution}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-start gap-3">
            <FileUp className="w-5 h-5 text-accent shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">Drag & Drop</p>
              <p className="text-xs text-text-muted mt-1">
                Drag files directly onto the upload zone for quick uploads
              </p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-start gap-3">
            <HardDrive className="w-5 h-5 text-accent shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">Auto-Detection</p>
              <p className="text-xs text-text-muted mt-1">
                OVA metadata is automatically extracted for VM configuration
              </p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-accent shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">Verification</p>
              <p className="text-xs text-text-muted mt-1">
                Uploads are verified and validated before being indexed
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Dialogs */}
      {isISOUploadOpen && (
        <ISOUploadDialog
          isOpen={isISOUploadOpen}
          onClose={() => {
            setIsISOUploadOpen(false);
            setSelectedType(null);
          }}
        />
      )}

      {isOVAUploadOpen && (
        <OVAUploadModal
          isOpen={isOVAUploadOpen}
          onClose={() => {
            setIsOVAUploadOpen(false);
            setSelectedType(null);
          }}
          onSuccess={() => {
            refetchOVA();
            setIsOVAUploadOpen(false);
            setSelectedType(null);
          }}
        />
      )}
    </div>
  );
}
