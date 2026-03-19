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
			wantCategory:  "upstream_server",
			wantRetryable: true,
		},
		{
			name:          "yunwu bad request",
			message:       "Yunwu HTTP 400 request_id=req-yunwu body=invalid request payload",
			wantStatus:    400,
			wantCode:      "bad_request",
			wantCategory:  "upstream_request",
			wantRetryable: false,
		},
		{
			name:          "generic status code too large",
			message:       "request failed with status code 413",
			wantStatus:    413,
			wantCode:      "request_too_large",
			wantCategory:  "upstream_request",
			wantRetryable: false,
		},
		{
			name:          "unauthorized status code",
			message:       "status=401 invalid api key",
			wantStatus:    401,
			wantCode:      "unauthorized",
			wantCategory:  "upstream_auth",
			wantRetryable: false,
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

func TestSummarizeErrorMessage_HTTPStatusMappings(t *testing.T) {
	tests := []struct {
		name         string
		message      string
		wantCode     string
		wantCategory string
		wantRetry    bool
	}{
		{
			name:         "403 forbidden",
			message:      "Gemini HTTP 403 request_id=req-forbidden body=permission denied",
			wantCode:     "forbidden",
			wantCategory: "upstream_permission",
			wantRetry:    false,
		},
		{
			name:         "404 not found",
			message:      "OpenAI HTTP 404 request_id=req-not-found body=model not found",
			wantCode:     "not_found",
			wantCategory: "upstream_request",
			wantRetry:    false,
		},
		{
			name:         "429 too many requests",
			message:      "HTTP 429 body=too many requests",
			wantCode:     "rate_limited",
			wantCategory: "upstream_capacity",
			wantRetry:    true,
		},
		{
			name:         "500 internal server error",
			message:      "Yunwu HTTP 500 request_id=req-500 body=internal server error",
			wantCode:     "internal_server_error",
			wantCategory: "upstream_server",
			wantRetry:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			summary := SummarizeErrorMessage(tc.message)
			if summary.Code != tc.wantCode {
				t.Fatalf("Code = %q, want %q", summary.Code, tc.wantCode)
			}
			if summary.Category != tc.wantCategory {
				t.Fatalf("Category = %q, want %q", summary.Category, tc.wantCategory)
			}
			if summary.Retryable != tc.wantRetry {
				t.Fatalf("Retryable = %t, want %t", summary.Retryable, tc.wantRetry)
			}
		})
	}
}

func TestSummarizeErrorMessage_ClassifiesLocalPermissionErrors(t *testing.T) {
	tests := []struct {
		name         string
		message      string
		wantCode     string
		wantCategory string
	}{
		{
			name:         "local storage permission denied",
			message:      "保存原图失败: 创建本地文件失败: open /tmp/a.png: permission denied",
			wantCode:     "local_permission_denied",
			wantCategory: "local_storage",
		},
		{
			name:         "operation not permitted",
			message:      "创建目录失败: mkdir /Users/demo/output: operation not permitted",
			wantCode:     "local_permission_denied",
			wantCategory: "local_storage",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			summary := SummarizeErrorMessage(tc.message)
			if summary.Code != tc.wantCode {
				t.Fatalf("Code = %q, want %q", summary.Code, tc.wantCode)
			}
			if summary.Category != tc.wantCategory {
				t.Fatalf("Category = %q, want %q", summary.Category, tc.wantCategory)
			}
			if summary.Retryable {
				t.Fatalf("Retryable = %t, want false", summary.Retryable)
			}
		})
	}
}

func TestSummarizeErrorMessage_ClassifiesPromptOptimizeConfigErrors(t *testing.T) {
	tests := []struct {
		name         string
		message      string
		wantCode     string
		wantCategory string
	}{
		{
			name:         "missing api key",
			message:      "提示词优化失败: Provider API Key 未配置",
			wantCode:     "prompt_optimize_auth_missing",
			wantCategory: "local_config",
		},
		{
			name:         "missing model",
			message:      "提示词优化失败: 未找到可用的模型",
			wantCode:     "prompt_optimize_model_missing",
			wantCategory: "local_config",
		},
		{
			name:         "missing provider",
			message:      "提示词优化失败: 未找到指定的 Provider: openai-chat",
			wantCode:     "prompt_optimize_provider_missing",
			wantCategory: "local_config",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			summary := SummarizeErrorMessage(tc.message)
			if summary.Code != tc.wantCode {
				t.Fatalf("Code = %q, want %q", summary.Code, tc.wantCode)
			}
			if summary.Category != tc.wantCategory {
				t.Fatalf("Category = %q, want %q", summary.Category, tc.wantCategory)
			}
			if summary.UserMessage == "" || summary.UserMessage == "生成失败，请稍后重试。" {
				t.Fatalf("UserMessage = %q, want a specific actionable message", summary.UserMessage)
			}
		})
	}
}
