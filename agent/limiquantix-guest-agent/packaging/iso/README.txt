=============================================
QUANTIX KVM AGENT TOOLS
=============================================

Thank you for using Quantix KVM! This ISO contains
everything needed to install the Quantix KVM Agent
in your virtual machine.

The agent enables deep integration between your VM
and the Quantix KVM hypervisor, similar to VMware Tools.

=============================================
QUICK START
=============================================

Linux Installation (Recommended):
---------------------------------
1. Mount this ISO to your VM's CD-ROM drive
2. Open a terminal in the VM
3. Run the following command:

   sudo /mnt/cdrom/linux/install.sh

   (Replace /mnt/cdrom with your actual mount point)

The installer will automatically:
- Detect your Linux distribution
- Install the QEMU Guest Agent
- Install the Quantix KVM Agent
- Configure and start both services

Windows Installation:
---------------------
Windows support is coming soon. For now, use the
QEMU Guest Agent from the virtio-win drivers ISO.

=============================================
FEATURES
=============================================

Once installed, the Quantix KVM Agent provides:

  * Real-time Monitoring
    - CPU, memory, disk, network usage
    - Process and service lists
    - Hardware inventory

  * Remote Management
    - Execute commands remotely
    - Transfer files without SSH
    - Graceful shutdown/reboot

  * VM Integration
    - Password reset
    - Hostname and network configuration
    - Time synchronization

  * Snapshot Support
    - Filesystem quiescing (fsfreeze)
    - Application-aware snapshots

  * Desktop Features (if applicable)
    - Display resize
    - Clipboard sharing

=============================================
SUPPORTED DISTRIBUTIONS
=============================================

The universal installer supports:

  Debian-based:
    - Ubuntu 18.04, 20.04, 22.04, 24.04
    - Debian 10, 11, 12
    - Linux Mint
    - Pop!_OS

  RHEL-based:
    - Rocky Linux 8, 9
    - AlmaLinux 8, 9
    - CentOS 7, Stream 8/9
    - RHEL 7, 8, 9
    - Fedora 35+
    - Oracle Linux

  Other:
    - openSUSE Leap 15+
    - SUSE Linux Enterprise
    - Arch Linux
    - Manjaro
    - Alpine Linux 3.14+
    - Gentoo
    - Void Linux

  Any other Linux distribution can use the
  static binary installation.

=============================================
INSTALLER OPTIONS
=============================================

The install.sh script accepts these options:

  --skip-qemu-ga    Skip QEMU Guest Agent installation
                    (use if already installed)

  --binary-only     Install only the static binary
                    (no DEB/RPM packages)

  --uninstall       Remove the Quantix KVM Agent

  --help            Show help message

Example:
  sudo ./install.sh --skip-qemu-ga

=============================================
TROUBLESHOOTING
=============================================

Agent not connecting?
--------------------
1. Check if services are running:
   systemctl status quantix-kvm-agent
   systemctl status qemu-guest-agent

2. Check for SELinux issues (RHEL-based):
   sudo restorecon -v /usr/local/bin/quantix-kvm-agent

3. Verify virtio-serial device:
   ls -la /dev/virtio-ports/

4. Check agent logs:
   journalctl -u quantix-kvm-agent -n 50

No virtio-serial device?
------------------------
The VM must be configured with a virtio-serial
channel. In libvirt, this looks like:

  <channel type='unix'>
    <target type='virtio' name='org.quantix.agent.0'/>
  </channel>

If using Quantix KVM, this is configured automatically.
You may need to restart the VM after installation.

Permission denied on RHEL/Rocky?
--------------------------------
SELinux may be blocking execution. Run:
  sudo chcon -t bin_t /usr/local/bin/quantix-kvm-agent
  sudo restorecon -v /usr/local/bin/quantix-kvm-agent

=============================================
FILES INCLUDED
=============================================

linux/
  install.sh                - Universal installer
  quantix-kvm-agent-amd64   - Static binary (x86_64)
  quantix-kvm-agent-arm64   - Static binary (ARM64)
  *.deb                     - Debian/Ubuntu packages
  *.rpm                     - RHEL/CentOS packages

windows/
  README.txt                - Windows instructions
  (Windows installer coming soon)

VERSION                     - ISO version number
README.txt                  - This file

=============================================
CONTACT & SUPPORT
=============================================

Documentation:
  https://github.com/Quantix-KVM/LimiQuantix

Report Issues:
  https://github.com/Quantix-KVM/LimiQuantix/issues

=============================================
