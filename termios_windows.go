//go:build windows

package main

import (
	"bufio"
	"errors"
	"os"
)

// getTermios is unsupported on Windows; callers fall back to normal input.
func getTermios(fd int) (*int, error) {
	return nil, errors.New("unsupported")
}

// disableEcho is a no-op stub on Windows.
func disableEcho(fd int, t *int) error { return errors.New("unsupported") }

// setTermios is a no-op stub on Windows.
func setTermios(fd int, t *int) {}

// fallbackReader returns a plain buffered reader for non-terminal input.
func fallbackReader() *bufio.Reader {
	return bufio.NewReader(os.Stdin)
}
