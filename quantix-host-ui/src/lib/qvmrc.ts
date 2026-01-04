/**
 * QVMRC Deep Link Launcher
 * 
 * Launches the QVMRC native console application via the qvmrc:// protocol.
 * The QVMRC app must be installed and registered on the user's system.
 */

export interface QVMRCLaunchOptions {
  /** Host URL (e.g., https://192.168.1.100:8443) */
  hostUrl: string;
  /** VM ID */
  vmId: string;
  /** VM display name */
  vmName: string;
  /** Optional VNC password */
  password?: string;
  /** Whether to start in fullscreen mode */
  fullscreen?: boolean;
}

/**
 * Launch QVMRC to connect to a VM console
 */
export function launchQVMRC(options: QVMRCLaunchOptions): void {
  const params = new URLSearchParams({
    url: options.hostUrl,
    vm: options.vmId,
    name: options.vmName,
  });

  if (options.password) {
    params.set('password', options.password);
  }

  if (options.fullscreen) {
    params.set('fullscreen', 'true');
  }

  const deepLink = `qvmrc://connect?${params.toString()}`;
  
  // Log for debugging
  console.info('Launching QVMRC:', deepLink);
  
  // Trigger the deep link
  window.location.href = deepLink;
}

/**
 * Check if QVMRC protocol is likely registered
 * Note: This is a best-effort check, as browsers don't expose protocol handlers
 */
export function checkQVMRCAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // Try to detect if the protocol handler exists
    // This is limited by browser security, so we assume it's available
    // if we're in a context where it could be installed
    const isElectron = navigator.userAgent.includes('Electron');
    const isTauri = '__TAURI__' in window;
    
    // If we're in a native context, QVMRC is likely available
    if (isElectron || isTauri) {
      resolve(true);
      return;
    }
    
    // For web browsers, we can't reliably detect, so assume available
    resolve(true);
  });
}

/**
 * Get the download URL for QVMRC installer
 */
export function getQVMRCDownloadUrl(): string {
  const platform = navigator.platform.toLowerCase();
  
  if (platform.includes('win')) {
    return '/downloads/qvmrc-setup.exe';
  } else if (platform.includes('mac')) {
    return '/downloads/qvmrc.dmg';
  } else {
    return '/downloads/qvmrc.AppImage';
  }
}
