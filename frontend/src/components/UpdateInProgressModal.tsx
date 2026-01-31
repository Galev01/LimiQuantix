import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Server,
  Database,
  Layout,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApiConnection } from '@/hooks/useApiConnection';

interface UpdateInProgressModalProps {
  isOpen: boolean;
  onReconnected?: () => void;
}

type UpdatePhase = 'updating' | 'restarting' | 'reconnecting' | 'complete' | 'error';

interface ComponentStatus {
  name: string;
  icon: React.ReactNode;
  status: 'pending' | 'updating' | 'complete' | 'error';
}

/**
 * Modal that displays when the QvDC control plane is updating.
 * Shows progress and automatically reconnects when the service is back up.
 */
export function UpdateInProgressModal({ isOpen, onReconnected }: UpdateInProgressModalProps) {
  const [phase, setPhase] = useState<UpdatePhase>('updating');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [components, setComponents] = useState<ComponentStatus[]>([
    { name: 'Dashboard', icon: <Layout className="w-4 h-4" />, status: 'pending' },
    { name: 'Control Plane', icon: <Server className="w-4 h-4" />, status: 'pending' },
    { name: 'Database Migrations', icon: <Database className="w-4 h-4" />, status: 'pending' },
  ]);
  
  const { isConnected, reconnect: checkConnection } = useApiConnection();
  
  // Simulate component updates (in real implementation, this would come from WebSocket/SSE)
  useEffect(() => {
    if (!isOpen) return;
    
    // Simulate update progress
    const timers: ReturnType<typeof setTimeout>[] = [];
    
    // Dashboard update
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Dashboard' ? { ...c, status: 'updating' } : c
      ));
    }, 500));
    
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Dashboard' ? { ...c, status: 'complete' } : c
      ));
    }, 2000));
    
    // Control Plane update
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Control Plane' ? { ...c, status: 'updating' } : c
      ));
    }, 2500));
    
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Control Plane' ? { ...c, status: 'complete' } : c
      ));
      setPhase('restarting');
    }, 5000));
    
    // Database migrations
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Database Migrations' ? { ...c, status: 'updating' } : c
      ));
    }, 5500));
    
    timers.push(setTimeout(() => {
      setComponents(prev => prev.map(c => 
        c.name === 'Database Migrations' ? { ...c, status: 'complete' } : c
      ));
      setPhase('reconnecting');
    }, 7000));
    
    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, [isOpen]);
  
  // Reconnection logic
  const attemptReconnect = useCallback(async () => {
    if (phase !== 'reconnecting') return;
    
    setReconnectAttempts(prev => prev + 1);
    
    try {
      await checkConnection();
      // After reconnect attempt, wait a bit and check isConnected
      setTimeout(() => {
        // Check connection status will update isConnected via the hook
        // We'll rely on the useEffect below to handle success
      }, 1000);
    } catch {
      // Retry after delay
      setTimeout(attemptReconnect, 2000);
    }
  }, [phase, checkConnection]);
  
  // Watch isConnected to complete reconnection
  useEffect(() => {
    if (phase === 'reconnecting' && isConnected) {
      setPhase('complete');
      setTimeout(() => {
        onReconnected?.();
      }, 1500);
    }
  }, [phase, isConnected, onReconnected]);
  
  useEffect(() => {
    if (phase === 'reconnecting') {
      attemptReconnect();
    }
  }, [phase, attemptReconnect]);
  
  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPhase('updating');
      setReconnectAttempts(0);
      setComponents([
        { name: 'Dashboard', icon: <Layout className="w-4 h-4" />, status: 'pending' },
        { name: 'Control Plane', icon: <Server className="w-4 h-4" />, status: 'pending' },
        { name: 'Database Migrations', icon: <Database className="w-4 h-4" />, status: 'pending' },
      ]);
    }
  }, [isOpen]);
  
  const getPhaseMessage = () => {
    switch (phase) {
      case 'updating':
        return 'Installing updates...';
      case 'restarting':
        return 'Restarting control plane...';
      case 'reconnecting':
        return `Reconnecting... (attempt ${reconnectAttempts})`;
      case 'complete':
        return 'Update complete!';
      case 'error':
        return 'Update failed';
      default:
        return 'Updating...';
    }
  };
  
  const getPhaseIcon = () => {
    switch (phase) {
      case 'complete':
        return <CheckCircle2 className="w-8 h-8 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-8 h-8 text-red-500" />;
      default:
        return <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />;
    }
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          
          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative z-10 w-full max-w-md mx-4"
          >
            <div className="bg-[#1a1d2e] rounded-xl border border-white/10 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-6 py-5 border-b border-white/10 bg-gradient-to-r from-blue-500/10 to-purple-500/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <RefreshCw className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">System Update</h2>
                    <p className="text-sm text-gray-400">Quantix-vDC is being updated</p>
                  </div>
                </div>
              </div>
              
              {/* Content */}
              <div className="px-6 py-5 space-y-6">
                {/* Phase indicator */}
                <div className="flex flex-col items-center gap-3 py-4">
                  {getPhaseIcon()}
                  <p className="text-white font-medium">{getPhaseMessage()}</p>
                </div>
                
                {/* Component status list */}
                <div className="space-y-3">
                  {components.map((component) => (
                    <div
                      key={component.name}
                      className={cn(
                        "flex items-center justify-between px-4 py-3 rounded-lg",
                        "bg-white/5 border border-white/10"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-lg",
                          component.status === 'complete' ? "bg-green-500/20 text-green-400" :
                          component.status === 'updating' ? "bg-blue-500/20 text-blue-400" :
                          component.status === 'error' ? "bg-red-500/20 text-red-400" :
                          "bg-gray-500/20 text-gray-400"
                        )}>
                          {component.icon}
                        </div>
                        <span className="text-white">{component.name}</span>
                      </div>
                      
                      <div>
                        {component.status === 'pending' && (
                          <span className="text-gray-500 text-sm">Pending</span>
                        )}
                        {component.status === 'updating' && (
                          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                        )}
                        {component.status === 'complete' && (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        )}
                        {component.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        phase === 'complete' ? "bg-green-500" :
                        phase === 'error' ? "bg-red-500" :
                        "bg-gradient-to-r from-blue-500 to-purple-500"
                      )}
                      initial={{ width: '0%' }}
                      animate={{
                        width: phase === 'complete' ? '100%' :
                               phase === 'reconnecting' ? '90%' :
                               phase === 'restarting' ? '70%' :
                               `${(components.filter(c => c.status === 'complete').length / components.length) * 60}%`
                      }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center">
                    Please wait while the system updates. Do not close this window.
                  </p>
                </div>
              </div>
              
              {/* Footer - only show when complete */}
              {phase === 'complete' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="px-6 py-4 border-t border-white/10 bg-green-500/5"
                >
                  <p className="text-center text-green-400 text-sm">
                    Update successful! Refreshing page...
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default UpdateInProgressModal;
