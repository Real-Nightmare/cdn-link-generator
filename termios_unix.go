//go:build linux

package main

import (
	"bufio"
	"os"
	"syscall"
	"unsafe"
)

// getTermios fetches current terminal attributes.
func getTermios(fd int) (*syscall.Termios, error) {
	var t syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TCGETS), uintptr(unsafe.Pointer(&t)))
	if errno != 0 {
		return nil, errno
	}
	return &t, nil
}

// disableEcho turns off terminal echo for password-style input.
func disableEcho(fd int, t *syscall.Termios) error {
	noEcho := *t
	noEcho.Lflag &^= syscall.ECHO
	noEcho.Lflag |= syscall.ICANON | syscall.ECHONL
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TCSETS), uintptr(unsafe.Pointer(&noEcho)))
	if errno != 0 {
		return errno
	}
	return nil
}

// setTermios restores terminal attributes.
func setTermios(fd int, t *syscall.Termios) {
	syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TCSETS), uintptr(unsafe.Pointer(&t)))
}

// fallbackReader returns a plain buffered reader for non-terminal input.
func fallbackReader() *bufio.Reader {
	return bufio.NewReader(os.Stdin)
}
