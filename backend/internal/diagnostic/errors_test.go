package diagnostic

import "testing"

func TestSummarizeErrorMessage_ExtractsHTTPStatusFromProviderErrors(t *testing.T) {
	tests := []struct {
		name          string
		message       string
		wantStatus    int
		wantCode      string
		wantCategory  string
		wantRetryable bool
	}{
		{
			name:          "gemini bad request",
			message:       "Gemini HTTP 400 request_id=req-gemini body=invalid aspect ratio",
			wantStatus:    400,
			wantCode:      "bad_request",
			wantCategory:  "upstream_request",
			wantRetryable: false,
		},
		{
			name:          "openai service unavailable",
			message:       "OpenAI HTTP 503 request_id=req-openai body=service temporarily unavailable",
			wantStatus:    503,
			wantCode:      "service_unavailable",
			wantCategory:  "upstream_gateway",
			wantRetryable: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			summary := SummarizeErrorMessage(tc.message)
			if summary.HTTPStatus != tc.wantStatus {
				t.Fatalf("HTTPStatus = %d, want %d", summary.HTTPStatus, tc.wantStatus)
			}
			if summary.Code != tc.wantCode {
				t.Fatalf("Code = %q, want %q", summary.Code, tc.wantCode)
			}
			if summary.Category != tc.wantCategory {
				t.Fatalf("Category = %q, want %q", summary.Category, tc.wantCategory)
			}
			if summary.Retryable != tc.wantRetryable {
				t.Fatalf("Retryable = %t, want %t", summary.Retryable, tc.wantRetryable)
			}
		})
	}
}
