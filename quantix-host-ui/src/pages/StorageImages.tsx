import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/layout';
import { Card, Button, Badge, Input, Select } from '@/components/ui';
import { 
    Upload, Trash2, File, Disc, Box, HardDrive, RefreshCw, AlertCircle,
    Folder, FolderOpen, ChevronRight, Search, FolderPlus, Move
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { 
    listIsos, listIsoFolders, uploadImage, deleteIso, moveIsoToFolder,
    scanIsoDirectories, listStoragePools, type IsoMetadata 
} from '@/api/storage';
import { toast } from 'sonner';

export function StorageImages() {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [currentFolder, setCurrentFolder] = useState('/');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPoolId, setSelectedPoolId] = useState<string>('');
    const [selectedUploadFolder, setSelectedUploadFolder] = useState('/');
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
    const [moveTargetFolder, setMoveTargetFolder] = useState('/');
    const queryClient = useQueryClient();

    // Fetch ISOs
    const { data: isos = [], isLoading, refetch } = useQuery({
        queryKey: ['storage', 'isos', currentFolder],
        queryFn: () => listIsos({ folder: currentFolder, includeSubfolders: false }),
    });

    // Fetch folders
    const { data: folders = [] } = useQuery({
        queryKey: ['storage', 'iso-folders'],
        queryFn: listIsoFolders,
    });

    // Fetch storage pools for upload destination
    const { data: pools = [] } = useQuery({
        queryKey: ['storage', 'pools'],
        queryFn: listStoragePools,
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: deleteIso,
        onSuccess: () => {
            toast.success('ISO deleted');
            queryClient.invalidateQueries({ queryKey: ['storage', 'isos'] });
            queryClient.invalidateQueries({ queryKey: ['storage', 'iso-folders'] });
        },
        onError: (error: Error) => {
            toast.error(`Delete failed: ${error.message}`);
        },
    });

    // Move mutation
    const moveMutation = useMutation({
        mutationFn: ({ id, folder }: { id: string; folder: string }) => 
            moveIsoToFolder(id, folder),
        onSuccess: () => {
            toast.success('ISO moved');
            queryClient.invalidateQueries({ queryKey: ['storage', 'isos'] });
            queryClient.invalidateQueries({ queryKey: ['storage', 'iso-folders'] });
            setMoveDialogOpen(false);
            setMoveTargetId(null);
        },
        onError: (error: Error) => {
            toast.error(`Move failed: ${error.message}`);
        },
    });

    // Scan directories mutation
    const scanMutation = useMutation({
        mutationFn: scanIsoDirectories,
        onSuccess: (result) => {
            toast.success(`Scan complete: ${result.registered} new, ${result.existing} existing`);
            queryClient.invalidateQueries({ queryKey: ['storage', 'isos'] });
            queryClient.invalidateQueries({ queryKey: ['storage', 'iso-folders'] });
        },
        onError: (error: Error) => {
            toast.error(`Scan failed: ${error.message}`);
        },
    });

    // Build folder tree structure
    const folderTree = useMemo(() => {
        const tree: { [key: string]: string[] } = { '/': [] };
        
        folders.forEach(folder => {
            if (folder === '/') return;
            
            const parts = folder.split('/').filter(Boolean);
            let parent = '/';
            parts.forEach((part, index) => {
                const current = '/' + parts.slice(0, index + 1).join('/');
                if (!tree[parent]) tree[parent] = [];
                if (!tree[parent].includes(current)) {
                    tree[parent].push(current);
                }
                parent = current;
            });
        });
        
        return tree;
    }, [folders]);

    // Filtered ISOs
    const filteredIsos = useMemo(() => {
        if (!searchQuery) return isos;
        const query = searchQuery.toLowerCase();
        return isos.filter(iso => 
            iso.name.toLowerCase().includes(query) ||
            iso.filename.toLowerCase().includes(query)
        );
    }, [isos, searchQuery]);

    // Upload handler
    const handleUpload = async () => {
        if (!selectedFile) return;

        setUploading(true);
        setUploadProgress(0);
        setUploadError(null);

        try {
            const result = await uploadImage(
                selectedFile, 
                (percent) => setUploadProgress(percent),
                { 
                    poolId: selectedPoolId || undefined, 
                    folder: selectedUploadFolder 
                }
            );

            if (result.success) {
                toast.success(`Uploaded ${selectedFile.name} successfully`);
                setSelectedFile(null);
                queryClient.invalidateQueries({ queryKey: ['storage', 'isos'] });
                queryClient.invalidateQueries({ queryKey: ['storage', 'iso-folders'] });
            } else {
                throw new Error(result.message || 'Upload failed');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed';
            console.error('Upload failed:', error);
            setUploadError(message);
            toast.error(`Upload failed: ${message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (iso: IsoMetadata) => {
        if (!confirm(`Delete "${iso.name}"? This will also delete the file from disk.`)) return;
        deleteMutation.mutate(iso.id);
    };

    const openMoveDialog = (iso: IsoMetadata) => {
        setMoveTargetId(iso.id);
        setMoveTargetFolder(iso.folderPath);
        setMoveDialogOpen(true);
    };

    const handleMove = () => {
        if (!moveTargetId) return;
        moveMutation.mutate({ id: moveTargetId, folder: moveTargetFolder });
    };

    const getIconForFormat = (format: string) => {
        switch (format.toLowerCase()) {
            case 'iso': return <Disc className="w-5 h-5 text-accent" />;
            case 'qcow2': return <HardDrive className="w-5 h-5 text-info" />;
            case 'ova': return <Box className="w-5 h-5 text-warning" />;
            default: return <File className="w-5 h-5 text-text-muted" />;
        }
    };

    const getFolderName = (path: string) => {
        if (path === '/') return 'Root';
        return path.split('/').pop() || path;
    };

    // Breadcrumb navigation
    const breadcrumbs = useMemo(() => {
        const parts = currentFolder.split('/').filter(Boolean);
        const crumbs = [{ path: '/', name: 'Root' }];
        let current = '';
        parts.forEach(part => {
            current += '/' + part;
            crumbs.push({ path: current, name: part });
        });
        return crumbs;
    }, [currentFolder]);

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <Header
                title="Storage Images"
                subtitle="Manage ISOs and VM templates with folder organization"
                actions={
                    <div className="flex items-center gap-2">
                        <Button 
                            variant="secondary" 
                            size="sm" 
                            onClick={() => scanMutation.mutate()}
                            disabled={scanMutation.isPending}
                        >
                            {scanMutation.isPending ? 'Scanning...' : 'Scan Directories'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => refetch()}>
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 flex overflow-hidden">
                {/* Folder Sidebar */}
                <div className="w-64 border-r border-border p-4 overflow-y-auto">
                    <h4 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
                        <FolderPlus className="w-4 h-4" />
                        Folders
                    </h4>
                    <FolderTreeItem
                        path="/"
                        name="Root"
                        isOpen={true}
                        isSelected={currentFolder === '/'}
                        children={folderTree['/']}
                        allFolders={folderTree}
                        currentFolder={currentFolder}
                        onSelect={setCurrentFolder}
                    />
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Breadcrumb */}
                    <div className="flex items-center gap-1 text-sm text-text-muted mb-4">
                        {breadcrumbs.map((crumb, index) => (
                            <div key={crumb.path} className="flex items-center">
                                {index > 0 && <ChevronRight className="w-4 h-4 mx-1" />}
                                <button
                                    onClick={() => setCurrentFolder(crumb.path)}
                                    className={cn(
                                        "hover:text-accent transition-colors",
                                        currentFolder === crumb.path && "text-accent font-medium"
                                    )}
                                >
                                    {crumb.name}
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Upload Section */}
                    <Card className="mb-6 p-6 border-dashed border-2 border-border hover:border-accent/50 transition-colors">
                        <div className="flex flex-col items-center justify-center text-center">
                            <div className="p-4 bg-bg-base rounded-full mb-4">
                                <Upload className="w-6 h-6 text-accent" />
                            </div>
                            <h3 className="text-lg font-medium text-text-primary mb-2">Upload New Image</h3>
                            <p className="text-text-muted mb-4 max-w-sm text-sm">
                                Supported formats: .iso, .qcow2, .ova, .img
                            </p>

                            <div className="flex flex-col gap-4 w-full max-w-lg">
                                <div className="flex items-center gap-4">
                                    <Input
                                        type="file"
                                        className="cursor-pointer flex-1"
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        accept=".iso,.qcow2,.ova,.img"
                                    />
                                </div>
                                
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <label className="text-xs text-text-muted mb-1 block">Storage Pool</label>
                                        <select
                                            value={selectedPoolId}
                                            onChange={(e) => setSelectedPoolId(e.target.value)}
                                            className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm"
                                        >
                                            <option value="">Default Location</option>
                                            {pools.map(pool => (
                                                <option key={pool.poolId} value={pool.poolId}>
                                                    {pool.poolId}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs text-text-muted mb-1 block">Folder</label>
                                        <select
                                            value={selectedUploadFolder}
                                            onChange={(e) => setSelectedUploadFolder(e.target.value)}
                                            className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm"
                                        >
                                            {folders.map(folder => (
                                                <option key={folder} value={folder}>
                                                    {folder === '/' ? '/ (Root)' : folder}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <Button
                                    onClick={handleUpload}
                                    disabled={!selectedFile || uploading}
                                    className="w-full"
                                >
                                    {uploading ? `Uploading ${uploadProgress}%` : 'Upload'}
                                </Button>
                            </div>

                            {uploading && (
                                <div className="w-full max-w-lg mt-4 h-2 bg-bg-base rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            )}

                            {uploadError && (
                                <div className="flex items-center gap-2 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error max-w-lg">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    <span className="text-sm">{uploadError}</span>
                                </div>
                            )}

                            {selectedFile && !uploading && !uploadError && (
                                <div className="flex items-center gap-2 mt-4 text-text-secondary text-sm">
                                    <File className="w-4 h-4" />
                                    <span>{selectedFile.name}</span>
                                    <span className="text-text-muted">({formatBytes(selectedFile.size)})</span>
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Search */}
                    <div className="flex items-center gap-4 mb-4">
                        <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                            <Input
                                placeholder="Search ISOs..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <span className="text-sm text-text-muted">
                            {filteredIsos.length} {filteredIsos.length === 1 ? 'image' : 'images'}
                        </span>
                    </div>

                    {/* Images List */}
                    <div className="grid gap-3">
                        {isLoading ? (
                            <div className="text-center py-8 text-text-muted">Loading images...</div>
                        ) : filteredIsos.length === 0 ? (
                            <div className="text-center py-8 text-text-muted bg-bg-surface rounded-lg border border-border">
                                {searchQuery 
                                    ? 'No images match your search' 
                                    : 'No images in this folder. Upload one to get started.'}
                            </div>
                        ) : (
                            filteredIsos.map((iso) => (
                                <Card key={iso.id} className="p-4 flex items-center justify-between group hover:border-accent/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 bg-bg-base rounded-lg">
                                            {getIconForFormat(iso.format)}
                                        </div>
                                        <div>
                                            <h4 className="font-medium text-text-primary">{iso.name}</h4>
                                            <div className="flex items-center gap-3 text-sm text-text-muted mt-1">
                                                <span>{formatBytes(iso.sizeBytes)}</span>
                                                <span>•</span>
                                                <Badge variant="default" size="sm" className="uppercase text-[10px]">
                                                    {iso.format}
                                                </Badge>
                                                {iso.osDistribution && (
                                                    <>
                                                        <span>•</span>
                                                        <span className="capitalize">{iso.osDistribution} {iso.osVersion}</span>
                                                    </>
                                                )}
                                            </div>
                                            <div className="text-xs text-text-muted/70 mt-1 font-mono">
                                                {iso.path}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button 
                                            variant="ghost" 
                                            size="sm"
                                            onClick={() => openMoveDialog(iso)}
                                            title="Move to folder"
                                        >
                                            <Move className="w-4 h-4" />
                                        </Button>
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="text-error hover:text-error hover:bg-error/10"
                                            onClick={() => handleDelete(iso)}
                                            disabled={deleteMutation.isPending}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Move Dialog */}
            {moveDialogOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <Card className="w-96 p-6">
                        <h3 className="text-lg font-semibold text-text-primary mb-4">Move to Folder</h3>
                        <select
                            value={moveTargetFolder}
                            onChange={(e) => setMoveTargetFolder(e.target.value)}
                            className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg mb-4"
                        >
                            {folders.map(folder => (
                                <option key={folder} value={folder}>
                                    {folder === '/' ? '/ (Root)' : folder}
                                </option>
                            ))}
                        </select>
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setMoveDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleMove} disabled={moveMutation.isPending}>
                                {moveMutation.isPending ? 'Moving...' : 'Move'}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}

// Recursive folder tree component
interface FolderTreeItemProps {
    path: string;
    name: string;
    isOpen: boolean;
    isSelected: boolean;
    children?: string[];
    allFolders: { [key: string]: string[] };
    currentFolder: string;
    onSelect: (path: string) => void;
}

function FolderTreeItem({ 
    path, name, isOpen: defaultOpen, isSelected, children, allFolders, currentFolder, onSelect 
}: FolderTreeItemProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const hasChildren = children && children.length > 0;
    
    return (
        <div>
            <button
                onClick={() => {
                    onSelect(path);
                    if (hasChildren) setIsOpen(!isOpen);
                }}
                className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                    isSelected 
                        ? "bg-accent/10 text-accent" 
                        : "text-text-secondary hover:bg-bg-hover"
                )}
            >
                {hasChildren ? (
                    <ChevronRight className={cn(
                        "w-4 h-4 transition-transform",
                        isOpen && "rotate-90"
                    )} />
                ) : (
                    <span className="w-4" />
                )}
                {isOpen ? (
                    <FolderOpen className="w-4 h-4" />
                ) : (
                    <Folder className="w-4 h-4" />
                )}
                <span className="truncate">{name}</span>
            </button>
            
            {isOpen && hasChildren && (
                <div className="ml-4 border-l border-border/50 pl-2">
                    {children.map(childPath => (
                        <FolderTreeItem
                            key={childPath}
                            path={childPath}
                            name={childPath.split('/').pop() || childPath}
                            isOpen={false}
                            isSelected={currentFolder === childPath}
                            children={allFolders[childPath]}
                            allFolders={allFolders}
                            currentFolder={currentFolder}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
