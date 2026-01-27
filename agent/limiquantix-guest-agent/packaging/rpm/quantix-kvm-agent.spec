Name:           quantix-kvm-agent
Version:        0.1.0
Release:        1%{?dist}
Summary:        Quantix KVM Guest Agent for VM Integration
License:        Apache-2.0
URL:            https://github.com/Quantix-KVM/LimiQuantix
BuildArch:      x86_64

%description
The Quantix KVM Guest Agent is a lightweight daemon that runs inside
guest VMs to enable deep integration with the Quantix KVM hypervisor.
Similar to VMware Tools but for KVM/QEMU environments.

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
mkdir -p %{buildroot}/usr/local/bin
mkdir -p %{buildroot}/usr/lib/systemd/system
mkdir -p %{buildroot}/etc/quantix-kvm
mkdir -p %{buildroot}/etc/quantix-kvm/pre-freeze.d
mkdir -p %{buildroot}/etc/quantix-kvm/post-thaw.d
mkdir -p %{buildroot}/var/log/quantix-kvm

# Binary will be copied during build
install -m 755 %{_sourcedir}/quantix-kvm-agent %{buildroot}/usr/local/bin/
install -m 644 %{_sourcedir}/quantix-kvm-agent.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/agent.yaml %{buildroot}/etc/quantix-kvm/

%post
# Reload systemd
systemctl daemon-reload

# Enable the service
systemctl enable quantix-kvm-agent.service

# Start the service
systemctl start quantix-kvm-agent.service || true

echo "Quantix KVM Guest Agent installed and started."
echo "Configuration: /etc/quantix-kvm/agent.yaml"
echo "Logs: journalctl -u quantix-kvm-agent"

%preun
if [ $1 -eq 0 ]; then
    # Package removal, not upgrade
    systemctl stop quantix-kvm-agent.service || true
    systemctl disable quantix-kvm-agent.service || true
fi

%postun
if [ $1 -eq 0 ]; then
    # Package removal, not upgrade
    systemctl daemon-reload
fi

%files
%attr(755, root, root) /usr/local/bin/quantix-kvm-agent
%attr(644, root, root) /usr/lib/systemd/system/quantix-kvm-agent.service
%config(noreplace) %attr(644, root, root) /etc/quantix-kvm/agent.yaml
%dir %attr(755, root, root) /etc/quantix-kvm
%dir %attr(755, root, root) /etc/quantix-kvm/pre-freeze.d
%dir %attr(755, root, root) /etc/quantix-kvm/post-thaw.d
%dir %attr(755, root, root) /var/log/quantix-kvm

%changelog
* Sun Jan 27 2026 Quantix KVM Team <team@quantix-kvm.io> - 0.1.0-1
- Renamed from limiquantix-agent to quantix-kvm-agent
- Core features: telemetry, execution, file transfer, lifecycle management
- Desktop integration: display resize, clipboard sharing
- Process and service management
- Hardware/software inventory
- Self-update capability
