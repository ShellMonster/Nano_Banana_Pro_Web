package provider

import (
	"context"
	"errors"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"log"
	"net/http"
	"strings"
	"time"
)

func providerMaxRetries(cfg *model.ProviderConfig) int {
	if cfg == nil {
		return defaultMaxRetries("")
	}
	if cfg.MaxRetries < 0 {
		return defaultMaxRetries(cfg.ProviderName)
	}
	return cfg.MaxRetries
}

func shouldRetryRequestSendError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	raw := strings.ToLower(strings.TrimSpace(err.Error()))
	if raw == "" {
		return false
	}
	if strings.Contains(raw, "timeout") || strings.Contains(raw, "timed out") {
		return false
	}

	for _, marker := range []string{
		"unexpected eof",
		"eof",
		"reset by peer",
		"connection reset",
		"broken pipe",
		"use of closed network connection",
		"server closed idle connection",
	} {
		if strings.Contains(raw, marker) {
			return true
		}
	}
	return false
}

func doRequestWithRetry(
	ctx context.Context,
	params map[string]interface{},
	providerName string,
	maxRetries int,
	do func(attempt int) (*http.Response, error),
) (*http.Response, int, error) {
	totalAttempts := maxRetries + 1
	if totalAttempts <= 0 {
		totalAttempts = 1
	}

	var lastErr error
	for attempt := 1; attempt <= totalAttempts; attempt++ {
		resp, err := do(attempt)
		if err == nil {
			if attempt > 1 {
				diagnostic.Logf(params, "request_retry",
					"provider=%s status=success attempt=%d/%d",
					providerName,
					attempt,
					totalAttempts,
				)
			}
			return resp, attempt, nil
		}

		lastErr = err
		if attempt >= totalAttempts || !shouldRetryRequestSendError(err) {
			break
		}

		diagnostic.Logf(params, "request_retry",
			"provider=%s status=retrying attempt=%d/%d reason=%q",
			providerName,
			attempt,
			totalAttempts,
			diagnostic.Preview(err.Error(), 240),
		)

		delay := time.Duration(attempt) * 300 * time.Millisecond
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, attempt, ctx.Err()
		case <-timer.C:
		}
	}

	return nil, totalAttempts, lastErr
}

type retryRoundTripper struct {
	base         http.RoundTripper
	providerName string
	maxRetries   int
}

func NewRetryableTransport(base http.RoundTripper, providerName string, maxRetries int) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	if maxRetries <= 0 {
		return base
	}
	return &retryRoundTripper{
		base:         base,
		providerName: providerName,
		maxRetries:   maxRetries,
	}
}

func (rt *retryRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	totalAttempts := rt.maxRetries + 1
	if totalAttempts <= 1 {
		return rt.base.RoundTrip(req)
	}

	currentReq := req
	var lastErr error
	for attempt := 1; attempt <= totalAttempts; attempt++ {
		resp, err := rt.base.RoundTrip(currentReq)
		if err == nil {
			if attempt > 1 {
				log.Printf("[Retry][%s] status=success attempt=%d/%d", rt.providerName, attempt, totalAttempts)
			}
			return resp, nil
		}

		lastErr = err
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		if attempt >= totalAttempts || !shouldRetryRequestSendError(err) || req.GetBody == nil {
			break
		}

		log.Printf("[Retry][%s] status=retrying attempt=%d/%d reason=%q", rt.providerName, attempt, totalAttempts, diagnostic.Preview(err.Error(), 240))

		retryReq, cloneErr := cloneRetryRequest(req)
		if cloneErr != nil {
			lastErr = cloneErr
			break
		}

		timer := time.NewTimer(time.Duration(attempt) * 300 * time.Millisecond)
		select {
		case <-req.Context().Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, req.Context().Err()
		case <-timer.C:
		}

		currentReq = retryReq
	}

	return nil, lastErr
}

func cloneRetryRequest(req *http.Request) (*http.Request, error) {
	cloned := req.Clone(req.Context())
	if req.Body == nil || req.Body == http.NoBody {
		return cloned, nil
	}
	if req.GetBody == nil {
		return nil, errors.New("request body cannot be replayed for retry")
	}
	body, err := req.GetBody()
	if err != nil {
		return nil, err
	}
	cloned.Body = body
	return cloned, nil
}
