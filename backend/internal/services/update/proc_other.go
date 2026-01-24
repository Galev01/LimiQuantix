//go:build !linux

package update

import (
	"os/exec"
)

// setSysProcAttr is a no-op on non-Linux platforms.
// The Setsid syscall attribute is Linux-specific.
func setSysProcAttr(cmd *exec.Cmd) {
	// No-op on non-Linux platforms
}
