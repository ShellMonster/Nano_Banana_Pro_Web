package main

import (
	"net/http"
	"testing"
	"time"
)

func TestNewHTTPServerConfiguresConnectionTimeouts(t *testing.T) {
	server := newHTTPServer("127.0.0.1:0", http.NewServeMux())

	if server.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s, want 5s", server.ReadHeaderTimeout)
	}
	if server.ReadTimeout != 30*time.Second {
		t.Fatalf("ReadTimeout = %s, want 30s", server.ReadTimeout)
	}
	if server.WriteTimeout != 0 {
		t.Fatalf("WriteTimeout = %s, want 0 to preserve SSE streams", server.WriteTimeout)
	}
	if server.IdleTimeout != 120*time.Second {
		t.Fatalf("IdleTimeout = %s, want 120s", server.IdleTimeout)
	}
}
