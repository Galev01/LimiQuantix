/**
 * FileTransferPanel - File browser and transfer UI for VM guests
 * 
 * Features:
 * - Browse guest filesystem
 * - Drag-and-drop file upload
 * - Download files from guest
 * - Create directories
 * - Delete files
 */

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen,
  File,
  Upload,
  Download,
  Trash2,
  FolderPlus,
  ArrowLeft,
  RefreshCw,
  X,
  ChevronRight,
  Loader2,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import {
  useListDirectory,
  useUploadFile,
  useDownloadFile,
  useDeleteFile,
  useCreateDirectory,
  type FileEntry,
  type UploadProgress,
} from '@/hooks/useFileTransfer';

interface FileTransferPanelProps {
  vmId: string;
  controlPlaneUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FileTransferPanel({ vmId, isOpen, onClose }: FileTransferPanelProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Queries and mutations
  const { data: files, isLoading, refetch } = useListDirectory(vmId, currentPath, { enabled: isOpen });
  const uploadMutation = useUploadFile(vmId);
  const downloadMutation = useDownloadFile(vmId);
  const deleteMutation = useDeleteFile(vmId);
  const createDirMutation = useCreateDirectory(vmId);

  // Navigation
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigateTo('/' + parts.join('/'));
  }, [currentPath, navigateTo]);

  const handleFileClick = useCallback((file: FileEntry) => {
    if (file.isDir) {
      navigateTo(file.path);
    } else {
      // Toggle selection
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(file.path)) {
          next.delete(file.path);
        } else {
          next.add(file.path);
        }
        return next;
      });
    }
  }, [navigateTo]);

  // Upload handling
  const handleUpload = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const remotePath = `${currentPath.replace(/\/$/, '')}/${file.name}`;
      
      try {
        await uploadMutation.mutateAsync({
          file,
          remotePath,
          onProgress: setUploadProgress,
        });
      } finally {
        setUploadProgress(null);
      }
    }
    refetch();
  }, [currentPath, uploadMutation, refetch]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleUpload(e.target.files);
      e.target.value = ''; // Reset input
    }
  }, [handleUpload]);

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files?.length) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // Download selected
  const handleDownload = useCallback(() => {
    selectedFiles.forEach((path) => {
      downloadMutation.mutate({ remotePath: path });
    });
    setSelectedFiles(new Set());
  }, [selectedFiles, downloadMutation]);

  // Delete selected
  const handleDelete = useCallback(() => {
    if (!confirm(`Delete ${selectedFiles.size} file(s)?`)) return;
    
    selectedFiles.forEach((path) => {
      deleteMutation.mutate({ path });
    });
    setSelectedFiles(new Set());
  }, [selectedFiles, deleteMutation]);

  // Create folder
  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    
    const folderPath = `${currentPath.replace(/\/$/, '')}/${newFolderName}`;
    createDirMutation.mutate({ path: folderPath }, {
      onSuccess: () => {
        setShowNewFolderInput(false);
        setNewFolderName('');
        refetch();
      },
    });
  }, [currentPath, newFolderName, createDirMutation, refetch]);

  // Path breadcrumbs
  const pathParts = currentPath.split('/').filter(Boolean);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className={cn(
        'fixed right-0 top-0 bottom-0 w-96 z-50',
        'bg-bg-elevated border-l border-border shadow-2xl',
        'flex flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-accent" />
          <span className="font-semibold text-text-primary">File Transfer</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-bg-hover transition-colors"
        >
          <X className="w-4 h-4 text-text-muted" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
        <button
          onClick={navigateUp}
          disabled={currentPath === '/'}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            currentPath === '/' 
              ? 'text-text-muted cursor-not-allowed' 
              : 'hover:bg-bg-hover text-text-secondary'
          )}
          title="Go up"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        
        <button
          onClick={() => refetch()}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
          title="Upload files"
        >
          <Upload className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        <button
          onClick={() => setShowNewFolderInput(true)}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
          title="New folder"
        >
          <FolderPlus className="w-4 h-4" />
        </button>

        {selectedFiles.size > 0 && (
          <>
            <button
              onClick={handleDownload}
              className="p-1.5 rounded-md hover:bg-bg-hover text-accent transition-colors"
              title="Download selected"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-md hover:bg-error/10 text-error transition-colors"
              title="Delete selected"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Breadcrumb path */}
      <div className="flex items-center gap-1 px-3 py-2 text-xs border-b border-border overflow-x-auto">
        <button
          onClick={() => navigateTo('/')}
          className="hover:text-accent text-text-secondary transition-colors shrink-0"
        >
          /
        </button>
        {pathParts.map((part, index) => {
          const fullPath = '/' + pathParts.slice(0, index + 1).join('/');
          return (
            <span key={fullPath} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="w-3 h-3 text-text-muted" />
              <button
                onClick={() => navigateTo(fullPath)}
                className="hover:text-accent text-text-secondary transition-colors truncate max-w-[100px]"
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>

      {/* New folder input */}
      <AnimatePresence>
        {showNewFolderInput && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 py-2 border-b border-border"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-accent shrink-0" />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }
                }}
                placeholder="Folder name..."
                className={cn(
                  'flex-1 px-2 py-1 text-sm rounded',
                  'bg-bg-base border border-border',
                  'focus:outline-none focus:ring-1 focus:ring-accent'
                )}
                autoFocus
              />
              <Button
                size="sm"
                variant="primary"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || createDirMutation.isPending}
              >
                Create
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      <AnimatePresence>
        {uploadProgress && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 py-2 border-b border-border"
          >
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span className="text-text-secondary">Uploading...</span>
              <span className="text-accent font-medium">{uploadProgress.percent}%</span>
            </div>
            <div className="mt-1 h-1.5 bg-bg-base rounded-full overflow-hidden">
              <div 
                className="h-full bg-accent transition-all"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File list */}
      <div
        ref={dropZoneRef}
        className="flex-1 overflow-y-auto"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : !files?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <FolderOpen className="w-12 h-12 text-text-muted opacity-50 mb-3" />
            <p className="text-sm text-text-muted mb-4">Empty folder</p>
            <p className="text-xs text-text-muted">
              Drag and drop files here to upload
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => (
              <FileListItem
                key={file.path}
                file={file}
                isSelected={selectedFiles.has(file.path)}
                onClick={() => handleFileClick(file)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border text-xs text-text-muted">
        {selectedFiles.size > 0 ? (
          <span>{selectedFiles.size} file(s) selected</span>
        ) : (
          <span>{files?.length || 0} items</span>
        )}
      </div>
    </motion.div>
  );
}

interface FileListItemProps {
  file: FileEntry;
  isSelected: boolean;
  onClick: () => void;
}

function FileListItem({ file, isSelected, onClick }: FileListItemProps) {
  const Icon = file.isDir ? FolderOpen : File;
  
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const formatDate = (isoDate: string) => {
    if (!isoDate) return '—';
    try {
      return new Date(isoDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-bg-hover',
        isSelected && 'bg-accent/10 border-l-2 border-accent'
      )}
    >
      <Icon className={cn(
        'w-5 h-5 shrink-0',
        file.isDir ? 'text-accent' : 'text-text-muted'
      )} />
      
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm truncate',
          file.isDir ? 'text-text-primary font-medium' : 'text-text-secondary'
        )}>
          {file.name}
        </p>
      </div>
      
      {!file.isDir && (
        <span className="text-xs text-text-muted shrink-0">
          {formatSize(file.size)}
        </span>
      )}
      
      <span className="text-xs text-text-muted shrink-0 hidden sm:block">
        {formatDate(file.modTime)}
      </span>
      
      {file.isDir && (
        <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
      )}
    </button>
  );
}

export default FileTransferPanel;
