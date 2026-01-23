import { create } from 'zustand';
import type { UploadProgress } from '@/components/storage/UploadProgressToast';

interface UploadStore {
  uploads: UploadProgress[];
  addUpload: (upload: UploadProgress) => void;
  updateUpload: (id: string, updates: Partial<UploadProgress>) => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadStore>((set) => ({
  uploads: [],
  
  addUpload: (upload) => set((state) => ({
    uploads: [...state.uploads, upload],
  })),
  
  updateUpload: (id, updates) => set((state) => ({
    uploads: state.uploads.map((u) =>
      u.id === id ? { ...u, ...updates } : u
    ),
  })),
  
  removeUpload: (id) => set((state) => ({
    uploads: state.uploads.filter((u) => u.id !== id),
  })),
  
  clearCompleted: () => set((state) => ({
    uploads: state.uploads.filter((u) => u.status !== 'completed'),
  })),
}));
