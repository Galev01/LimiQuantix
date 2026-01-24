//go:build linux

package update

import (
	"os/exec"
	"syscall"
)

// setSysProcAttr sets Linux-specific process attributes for detaching the process.
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid: true, // Create new session
	}
}
