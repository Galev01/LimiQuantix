import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/layout';
import { Card, Button, Badge, Input } from '@/components/ui';
import { Upload, Trash2, File, Disc, Box, HardDrive, RefreshCw, AlertCircle } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { listImages, uploadImage } from '@/api/storage';
import { toast } from 'sonner';

export function StorageImages() {
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    // Fetch images
    const { data: images = [], isLoading, refetch } = useQuery({
        queryKey: ['storage', 'images'],
        queryFn: listImages,
    });

    // Upload handler
    const handleUpload = async () => {
        if (!selectedFile) return;

        setUploading(true);
        setUploadProgress(0);
        setUploadError(null);

        try {
            const result = await uploadImage(selectedFile, (percent) => {
                setUploadProgress(percent);
            });

            if (result.success) {
                toast.success(`Uploaded ${selectedFile.name} successfully`);
                setSelectedFile(null);
                // Invalidate and refetch images
                queryClient.invalidateQueries({ queryKey: ['storage', 'images'] });
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

    const getIconForFormat = (format: string) => {
        switch (format.toLowerCase()) {
            case 'iso': return <Disc className="w-5 h-5 text-accent" />;
            case 'qcow2': return <HardDrive className="w-5 h-5 text-info" />;
            case 'ova': return <Box className="w-5 h-5 text-warning" />;
            default: return <File className="w-5 h-5 text-text-muted" />;
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <Header
                title="Storage Images"
                subtitle="Manage ISOs and VM templates (OVA/QCOW2)"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => refetch()}>
                        <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                    </Button>
                }
            />

            <div className="flex-1 overflow-y-auto p-6">
                {/* Upload Section */}
                <Card className="mb-6 p-6 border-dashed border-2 border-border hover:border-accent/50 transition-colors">
                    <div className="flex flex-col items-center justify-center text-center">
                        <div className="p-4 bg-bg-base rounded-full mb-4">
                            <Upload className="w-6 h-6 text-accent" />
                        </div>
                        <h3 className="text-lg font-medium text-text-primary mb-2">Upload New Image</h3>
                        <p className="text-text-muted mb-6 max-w-sm">
                            Drag and drop your ISO or OVA file here, or click to browse.
                            Supported formats: .iso, .qcow2, .ova, .img
                        </p>

                        <div className="flex items-center gap-4 w-full max-w-md">
                            <Input
                                type="file"
                                className="cursor-pointer"
                                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                accept=".iso,.qcow2,.ova,.img"
                            />
                            <Button
                                onClick={handleUpload}
                                disabled={!selectedFile || uploading}
                                className="min-w-[100px]"
                            >
                                {uploading ? `${uploadProgress}%` : 'Upload'}
                            </Button>
                        </div>

                        {uploading && (
                            <div className="w-full max-w-md mt-4 h-2 bg-bg-base rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        )}

                        {uploadError && (
                            <div className="flex items-center gap-2 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error max-w-md">
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

                {/* Images List */}
                <h3 className="text-lg font-semibold text-text-primary mb-4">Available Images</h3>
                <div className="grid gap-4">
                    {isLoading ? (
                        <div className="text-center py-8 text-text-muted">Loading images...</div>
                    ) : images.length === 0 ? (
                        <div className="text-center py-8 text-text-muted bg-bg-surface rounded-lg border border-border">
                            No images found. Upload one to get started.
                        </div>
                    ) : (
                        images.map((image) => (
                            <Card key={image.imageId} className="p-4 flex items-center justify-between group hover:border-accent/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-bg-base rounded-lg">
                                        {getIconForFormat(image.format)}
                                    </div>
                                    <div>
                                        <h4 className="font-medium text-text-primary">{image.name}</h4>
                                        <div className="flex items-center gap-3 text-sm text-text-muted mt-1">
                                            <span>{formatBytes(image.sizeBytes)}</span>
                                            <span>•</span>
                                            <Badge variant="default" size="sm" className="uppercase text-[10px]">
                                                {image.format}
                                            </Badge>
                                            <span>•</span>
                                            <span className="font-mono text-xs opacity-70">{image.path}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {/* Actions like Delete/Convert could go here */}
                                    <Button variant="ghost" size="sm" className="text-error hover:text-error hover:bg-error/10">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
