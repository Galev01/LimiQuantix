# Workflow State: Fix Quantix-OS Boot - Finding Wrong Disk

## Problem

GRUB debug output revealed the TRUE issue:

```
Root device: hd0,gpt2       ← This is Ubuntu on the hard drive!
Prefix: (cd0)/boot/grub

=== Listing /boot ===
System.map-6.8.0-40-generic config-6.8.0-40-generic ...  ← Ubuntu files!
initrd.img initrd.img.old ...                            ← Ubuntu naming!

vmlinuz: FOUND
initramfs: NOT FOUND   ← Because Ubuntu uses initrd.img, not initramfs!
```

## Root Cause

**GRUB found Ubuntu BEFORE finding Quantix!**

The search command `search --no-floppy --file /boot/vmlinuz` found Ubuntu's `/boot/vmlinuz` on the hard drive (`hd0,gpt2`) before finding Quantix's on the USB.

- Ubuntu uses: `/boot/initrd.img`
- Quantix uses: `/boot/initramfs`

That's why "initramfs: NOT FOUND" - it was looking on the wrong disk!

## Fix Applied

Changed the GRUB search priority to find Quantix-specific files FIRST:

### Before (broken):
```grub
search --no-floppy --file /boot/vmlinuz --set=root  # Finds Ubuntu first!
```

### After (fixed):
```grub
# Priority 1: Search by volume label (most reliable)
search --no-floppy --label QUANTIX_OS --set=root

# Priority 2: Search for Quantix-specific squashfs
if [ -z "$root" ]; then
    search --no-floppy --file /quantix/system-1.0.0.squashfs --set=root
fi

# Priority 3: Search for our initramfs (not Ubuntu's initrd.img)
if [ -z "$root" ]; then
    search --no-floppy --file /boot/initramfs --set=root
fi
```

Also fixed the embedded EFI config with the same search order.

## Files Changed

- `quantix-os/builder/build-iso.sh`
  - Fixed main grub.cfg search order
  - Fixed embedded EFI early config search order
  - Improved debug menu to show if squashfs is found

## Testing

1. Rebuild ISO
2. Flash to USB (Rufus DD mode)
3. Boot on Dell Latitude
4. Debug menu should now show:
   - `squashfs: FOUND - This is Quantix!`
   - `initramfs: FOUND`

## Status: FIXED - Rebuild Required ✅
