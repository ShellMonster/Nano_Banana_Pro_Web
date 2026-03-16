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
