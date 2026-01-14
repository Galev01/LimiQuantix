# Workflow State

## Quantix-vDC Service Startup Diagnostics

### Status: IN PROGRESS

### Goal
Make Quantix-vDC boot reliably with PostgreSQL and nginx running so the control
plane can use persistent storage and the web UI is accessible.

### Plan
1. Harden `99-start-services.start` to create nginx log/tmp dirs before `nginx -t`.
2. Improve PostgreSQL startup fallback by locating `pg_ctl`/`pg_isready` paths.
3. Update Quantix-vDC appliance docs with troubleshooting steps.

### Log
- Plan created for vDC service startup fixes based on logs.
- Hardened nginx startup to ensure runtime dirs exist before config test.
- Improved PostgreSQL readiness and direct start fallback with explicit paths.
- Updated vDC appliance troubleshooting docs.

### References
- `Quantix-vDC/overlay/etc/local.d/99-start-services.start`
- `Quantix-vDC/builder/build-rootfs.sh`
- `docs/000051-quantix-vdc-appliance.md`
