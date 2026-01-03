import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  File,
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Copy,
  Loader2,
  Home,
  HardDrive,
  AlertCircle,
  Eye,
  X,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mode: string;
  modifiedAt: string;
  isSymlink?: boolean;
  symlinkTarget?: string;
}

interface FileBrowserProps {
  vmId: string;
  isOpen: boolean;
  onClose: () => void;
}

// Common paths for quick access
const QUICK_ACCESS = {
  linux: [
    { label: 'Home', path: '/home', icon: Home },
    { label: 'Root', path: '/', icon: HardDrive },
    { label: 'Var', path: '/var', icon: Folder },
    { label: 'Etc', path: '/etc', icon: Folder },
    { label: 'Tmp', path: '/tmp', icon: Folder },
  ],
  windows: [
    { label: 'C:', path: 'C:\\', icon: HardDrive },
    { label: 'Users', path: 'C:\\Users', icon: Home },
    { label: 'Program Files', path: 'C:\\Program Files', icon: Folder },
    { label: 'Windows', path: 'C:\\Windows', icon: Folder },
    { label: 'Temp', path: 'C:\\Windows\\Temp', icon: Folder },
  ],
};

export function FileBrowser({ vmId, isOpen, onClose }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  // Fetch directory contents
  const fetchDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);
    setSelectedFiles(new Set());

    try {
      const response = await fetch(`/api/vms/${vmId}/files/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to list directory');
      }

      const data = await response.json();
      setFiles(data.entries || []);
      setCurrentPath(path);
      
      // Detect Windows paths
      if (path.includes(':\\') || path.startsWith('C:')) {
        setIsWindows(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load directory';
      setError(message);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [vmId]);

  // Navigate to path
  const navigateTo = useCallback((path: string) => {
    setPathHistory(prev => [...prev, currentPath]);
    fetchDirectory(path);
  }, [currentPath, fetchDirectory]);

  // Go up one directory
  const goUp = useCallback(() => {
    const separator = isWindows ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    
    if (parts.length <= 1) {
      // At root
      if (isWindows) {
        fetchDirectory('C:\\');
      } else {
        fetchDirectory('/');
      }
    } else {
      parts.pop();
      const newPath = isWindows 
        ? parts.join(separator) + separator
        : separator + parts.join(separator);
      fetchDirectory(newPath);
    }
  }, [currentPath, isWindows, fetchDirectory]);

  // Go back in history
  const goBack = useCallback(() => {
    if (pathHistory.length > 0) {
      const prevPath = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      fetchDirectory(prevPath);
    }
  }, [pathHistory, fetchDirectory]);

  // Handle file click
  const handleFileClick = (file: FileEntry) => {
    if (file.isDirectory) {
      navigateTo(file.path);
    } else {
      // Toggle selection
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(file.path)) {
          newSet.delete(file.path);
        } else {
          newSet.add(file.path);
        }
        return newSet;
      });
    }
  };

  // Handle file double-click (preview)
  const handleFileDoubleClick = async (file: FileEntry) => {
    if (file.isDirectory) return;
    
    // Check if file is previewable (text-based, under 1MB)
    const previewableExtensions = [
      '.txt', '.log', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
      '.js', '.ts', '.py', '.go', '.rs', '.sh', '.bash', '.conf', '.cfg', '.ini',
      '.service', '.toml', '.env',
    ];
    
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const isPreviewable = previewableExtensions.includes(ext) && file.size < 1024 * 1024;
    
    if (!isPreviewable) {
      toast.info('File preview not available for this file type or size');
      return;
    }
    
    setPreviewFile(file);
    setIsPreviewLoading(true);
    setPreviewContent(null);
    
    try {
      const response = await fetch(`/api/vms/${vmId}/files/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to read file');
      }
      
      const data = await response.json();
      setPreviewContent(data.content);
    } catch (err) {
      toast.error('Failed to load file preview');
      setPreviewFile(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Download selected files
  const handleDownload = async () => {
    if (selectedFiles.size === 0) {
      toast.warning('No files selected');
      return;
    }
    
    for (const filePath of selectedFiles) {
      try {
        const response = await fetch(`/api/vms/${vmId}/files/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        });
        
        if (!response.ok) {
          throw new Error('Download failed');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split(/[/\\]/).pop() || 'download';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        toast.error(`Failed to download: ${filePath}`);
      }
    }
    
    toast.success(`Downloaded ${selectedFiles.size} file(s)`);
  };

  // Delete selected files
  const handleDelete = async () => {
    if (selectedFiles.size === 0) {
      toast.warning('No files selected');
      return;
    }
    
    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedFiles.size} file(s)?`
    );
    
    if (!confirmed) return;
    
    let successCount = 0;
    for (const filePath of selectedFiles) {
      try {
        const response = await fetch(`/api/vms/${vmId}/files/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        });
        
        if (response.ok) {
          successCount++;
        }
      } catch (err) {
        // Continue with other files
      }
    }
    
    if (successCount > 0) {
      toast.success(`Deleted ${successCount} file(s)`);
      fetchDirectory(currentPath);
    }
  };

  // Initial load
  useEffect(() => {
    if (isOpen) {
      fetchDirectory('/');
    }
  }, [isOpen, fetchDirectory]);

  if (!isOpen) return null;

  const quickAccess = isWindows ? QUICK_ACCESS.windows : QUICK_ACCESS.linux;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-[900px] h-[600px] bg-bg-surface rounded-xl border border-border shadow-floating-hover flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated">
          <div className="flex items-center gap-3">
            <Folder className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">File Browser</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <button
            onClick={goBack}
            disabled={pathHistory.length === 0}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            title="Go Back"
          >
            <ChevronRight className="w-4 h-4 text-text-muted rotate-180" />
          </button>
          <button
            onClick={goUp}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            title="Go Up"
          >
            <ArrowUp className="w-4 h-4 text-text-muted" />
          </button>
          <button
            onClick={() => fetchDirectory(currentPath)}
            disabled={isLoading}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4 text-text-muted', isLoading && 'animate-spin')} />
          </button>
          
          <div className="flex-1 mx-2">
            <input
              type="text"
              value={currentPath}
              onChange={(e) => setCurrentPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchDirectory(currentPath)}
              className="w-full px-3 py-1.5 text-sm font-mono bg-bg-base border border-border rounded-lg focus:outline-none focus:border-accent"
            />
          </div>
          
          <div className="flex items-center gap-1 border-l border-border pl-2">
            <button
              onClick={handleDownload}
              disabled={selectedFiles.size === 0}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
              title="Download"
            >
              <Download className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={handleDelete}
              disabled={selectedFiles.size === 0}
              className="p-2 rounded-lg hover:bg-error/20 transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Trash2 className="w-4 h-4 text-error" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Quick Access */}
          <div className="w-48 border-r border-border p-2 overflow-y-auto">
            <p className="text-xs font-medium text-text-muted px-2 mb-2">Quick Access</p>
            {quickAccess.map((item) => (
              <button
                key={item.path}
                onClick={() => navigateTo(item.path)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors',
                  currentPath.startsWith(item.path)
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:bg-bg-hover',
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </div>

          {/* File List */}
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading && files.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <AlertCircle className="w-12 h-12 text-error/50 mb-4" />
                <p className="text-text-muted">{error}</p>
                <button
                  onClick={() => fetchDirectory(currentPath)}
                  className="mt-4 px-4 py-2 text-sm bg-bg-elevated rounded-lg hover:bg-bg-hover"
                >
                  Retry
                </button>
              </div>
            ) : files.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-muted">
                <p>Directory is empty</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {files
                  .sort((a, b) => {
                    // Directories first, then alphabetical
                    if (a.isDirectory !== b.isDirectory) {
                      return a.isDirectory ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                  })
                  .map((file) => (
                    <FileRow
                      key={file.path}
                      file={file}
                      isSelected={selectedFiles.has(file.path)}
                      onClick={() => handleFileClick(file)}
                      onDoubleClick={() => handleFileDoubleClick(file)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-text-muted bg-bg-base">
          <span>{files.length} items</span>
          {selectedFiles.size > 0 && (
            <span>{selectedFiles.size} selected</span>
          )}
        </div>

        {/* File Preview Modal */}
        <AnimatePresence>
          {previewFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 flex items-center justify-center p-8"
              onClick={() => setPreviewFile(null)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-3xl h-full bg-bg-surface rounded-xl border border-border shadow-floating-hover flex flex-col overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-accent" />
                    <span className="font-mono text-sm text-text-primary">
                      {previewFile.name}
                    </span>
                  </div>
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="p-1 rounded hover:bg-bg-hover"
                  >
                    <X className="w-4 h-4 text-text-muted" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {isPreviewLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
                    </div>
                  ) : (
                    <pre className="font-mono text-sm text-text-secondary whitespace-pre-wrap">
                      {previewContent}
                    </pre>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function FileRow({
  file,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  file: FileEntry;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const Icon = getFileIcon(file);
  
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
        isSelected
          ? 'bg-accent/20 border border-accent/30'
          : 'hover:bg-bg-hover border border-transparent',
      )}
    >
      <Icon className={cn(
        'w-4 h-4 flex-shrink-0',
        file.isDirectory ? 'text-accent' : 'text-text-muted',
      )} />
      <span className="flex-1 truncate text-sm text-text-primary">
        {file.name}
        {file.isSymlink && (
          <span className="text-text-muted"> → {file.symlinkTarget}</span>
        )}
      </span>
      {!file.isDirectory && (
        <span className="text-xs text-text-muted">{formatBytes(file.size)}</span>
      )}
      <span className="text-xs text-text-muted font-mono w-24 text-right">
        {file.mode}
      </span>
    </div>
  );
}

function getFileIcon(file: FileEntry) {
  if (file.isDirectory) return Folder;
  
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  // Code files
  if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh'].includes(ext)) {
    return FileCode;
  }
  
  // Text files
  if (['.txt', '.md', '.log', '.json', '.yaml', '.yml', '.xml', '.html', '.css'].includes(ext)) {
    return FileText;
  }
  
  // Image files
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) {
    return FileImage;
  }
  
  // Archive files
  if (['.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar'].includes(ext)) {
    return FileArchive;
  }
  
  return File;
}
