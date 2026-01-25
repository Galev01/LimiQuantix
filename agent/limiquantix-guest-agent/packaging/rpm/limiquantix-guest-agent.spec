Name:           limiquantix-guest-agent
Version:        0.1.0
Release:        1%{?dist}
Summary:        LimiQuantix Guest Agent for VM Integration
License:        Apache-2.0
URL:            https://github.com/Quantix-KVM/LimiQuantix
BuildArch:      x86_64

%description
The LimiQuantix Guest Agent is a lightweight daemon that runs inside
guest VMs to enable deep integration with the LimiQuantix hypervisor.

Features:
- Real-time telemetry (CPU, memory, disk, network)
- Remote command execution
- File transfer without SSH
- Graceful shutdown/reboot
- Password reset
- Filesystem quiescing for snapshots
- Time synchronization
- Display resize (desktop VMs)
- Clipboard sharing
- Process and service management
- Hardware/software inventory
- Self-update capability

%install
mkdir -p %{buildroot}/usr/bin
mkdir -p %{buildroot}/usr/lib/systemd/system
mkdir -p %{buildroot}/etc/limiquantix
mkdir -p %{buildroot}/etc/limiquantix/pre-freeze.d
mkdir -p %{buildroot}/etc/limiquantix/post-thaw.d
mkdir -p %{buildroot}/var/log/limiquantix

# Binary will be copied during build
install -m 755 %{_sourcedir}/limiquantix-agent %{buildroot}/usr/bin/
install -m 644 %{_sourcedir}/limiquantix-agent.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/agent.yaml %{buildroot}/etc/limiquantix/

%post
# Reload systemd
systemctl daemon-reload

# Enable the service
systemctl enable limiquantix-agent.service

# Start the service
systemctl start limiquantix-agent.service || true

echo "LimiQuantix Guest Agent installed and started."
echo "Configuration: /etc/limiquantix/agent.yaml"
echo "Logs: journalctl -u limiquantix-agent"

%preun
if [ $1 -eq 0 ]; then
    # Package removal, not upgrade
    systemctl stop limiquantix-agent.service || true
    systemctl disable limiquantix-agent.service || true
fi

%postun
if [ $1 -eq 0 ]; then
    # Package removal, not upgrade
    systemctl daemon-reload
fi

%files
%attr(755, root, root) /usr/bin/limiquantix-agent
%attr(644, root, root) /usr/lib/systemd/system/limiquantix-agent.service
%config(noreplace) %attr(644, root, root) /etc/limiquantix/agent.yaml
%dir %attr(755, root, root) /etc/limiquantix
%dir %attr(755, root, root) /etc/limiquantix/pre-freeze.d
%dir %attr(755, root, root) /etc/limiquantix/post-thaw.d
%dir %attr(755, root, root) /var/log/limiquantix

%changelog
* Sun Jan 25 2026 LimiQuantix Team <team@limiquantix.io> - 0.1.0-1
- Initial release
- Core features: telemetry, execution, file transfer, lifecycle management
- Desktop integration: display resize, clipboard sharing
- Process and service management
- Hardware/software inventory
- Self-update capability
