package diagnostic

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	requestIDPattern  = regexp.MustCompile(`(?i)(?:request[_\s-]?id|x-api-request-id|x-oneapi-request-id)\s*[:=]\s*([A-Za-z0-9._:-]+)`)
	httpStatusPattern = regexp.MustCompile(`(?i)(?:gemini|openai)\s+http\s+(\d{3})`)
)

type ErrorSummary struct {
	Type        string
	Code        string
	Category    string
	RequestID   string
	Retryable   bool
	HTTPStatus  int
	UserMessage string
	Detail      string
}

func SummarizeError(err error) ErrorSummary {
	if err == nil {
		return ErrorSummary{}
	}
	return SummarizeErrorMessage(err.Error())
}

func SummarizeErrorMessage(message string) ErrorSummary {
	rawMessage := strings.TrimSpace(message)
	raw := strings.ToLower(rawMessage)

	summary := ErrorSummary{
		Type:        "unknown",
		Code:        "unknown",
		Category:    "unknown",
		RequestID:   ExtractRequestID(rawMessage),
		UserMessage: "生成失败，请稍后重试。",
	}

	if match := httpStatusPattern.FindStringSubmatch(rawMessage); len(match) == 2 {
		if status, err := strconv.Atoi(match[1]); err == nil {
			summary.HTTPStatus = status
		}
	}

	set := func(code, category, userMessage string, retryable bool) {
		summary.Type = code
		summary.Code = code
		summary.Category = category
		summary.UserMessage = userMessage
		summary.Retryable = retryable
	}

	switch {
	case strings.Contains(raw, "任务队列已满"):
		set("queue_full", "local", "当前任务较多，队列已满，请稍后再试。", true)
	case strings.Contains(raw, "任务因应用重启中断"):
		set("app_interrupted", "local", "任务因应用重启或退出被中断，请重新生成。", true)
	case strings.Contains(raw, "任务超时未完成"), strings.Contains(raw, "生成超时"):
		set("task_timeout", "local", "生成等待超时，结果未能在设定时间内返回。请稍后重试。", true)
	case strings.Contains(raw, "context canceled"):
		set("request_canceled", "local", "请求已取消，生成未完成。", true)
	case strings.Contains(raw, "未在响应中找到图片数据"):
		summary.Detail = extractTextResponse(rawMessage)
		if summary.Detail != "" || strings.Contains(raw, "安全警告") || strings.Contains(raw, "无法") || strings.Contains(raw, "抱歉") {
			set("policy_blocked", "upstream_policy", "上游返回了文本但没有图片，可能触发了安全或合规限制。请调整提示词或参考图后重试。", false)
		} else {
			set("no_image_data", "upstream_response", "上游已返回响应，但里面没有图片数据。请稍后重试。", true)
		}
	case summary.HTTPStatus == 400:
		set("bad_request", "upstream_request", "请求参数不被上游接受，请检查提示词、模型或图片参数。", false)
	case summary.HTTPStatus == 401 || strings.Contains(raw, "unauthorized") || strings.Contains(raw, "invalid api key"):
		set("auth_failed", "upstream_auth", "上游鉴权失败，请检查 API Key 是否正确。", false)
	case summary.HTTPStatus == 403 || strings.Contains(raw, "quota"):
		if strings.Contains(raw, "quota") {
			set("quota_exceeded", "upstream_quota", "上游额度不足或已被限制，请检查账户余额、套餐或权限。", false)
		} else {
			set("forbidden", "upstream_auth", "上游拒绝了本次请求，请检查权限、模型可用性或账户状态。", false)
		}
	case summary.HTTPStatus == 404 || strings.Contains(raw, "not found"):
		set("model_not_found", "upstream_request", "请求的模型或接口不存在，请检查模型配置。", false)
	case summary.HTTPStatus == 408:
		set("upstream_timeout", "upstream_network", "上游等待超时，图片结果未能及时返回。请稍后重试。", true)
	case summary.HTTPStatus == 429 || strings.Contains(raw, "too many requests") || strings.Contains(raw, "负载已饱和") || strings.Contains(raw, "overloaded"):
		set("rate_limited", "upstream_capacity", "上游当前较忙或触发限流，请稍后再试。", true)
	case summary.HTTPStatus == 500:
		set("upstream_internal_error", "upstream_server", "上游服务内部异常，请稍后重试。", true)
	case summary.HTTPStatus == 502 || strings.Contains(raw, "bad gateway"):
		set("bad_gateway", "upstream_gateway", "上游网关异常，结果没有正常回传。请稍后重试。", true)
	case summary.HTTPStatus == 503:
		set("service_unavailable", "upstream_gateway", "上游服务暂时不可用，请稍后重试。", true)
	case summary.HTTPStatus == 504:
		set("gateway_timeout", "upstream_gateway", "上游网关等待超时，结果没有及时回传。请稍后重试。", true)
	case strings.Contains(raw, "tls"):
		set("tls_error", "upstream_network", "与上游建立安全连接失败，请稍后重试。", true)
	case strings.Contains(raw, "no such host"), strings.Contains(raw, "lookup "):
		set("dns_error", "upstream_network", "解析上游地址失败，请检查网络或服务地址配置。", true)
	case strings.Contains(raw, "connection refused"):
		set("connection_refused", "upstream_network", "无法连接到上游服务，请检查服务地址或网络连通性。", true)
	case strings.Contains(raw, "reset by peer"), strings.Contains(raw, "broken pipe"), strings.Contains(raw, "unexpected eof"), strings.Contains(raw, "eof"):
		set("upstream_connection_closed", "upstream_network", "与上游的连接被提前断开，图片结果未成功回传到本地。请稍后重试。", true)
	case strings.Contains(raw, "deadline exceeded"), strings.Contains(raw, "timeout"), strings.Contains(raw, "timed out"):
		set("timeout", "upstream_network", "请求等待超时，图片结果未能及时返回。请稍后重试。", true)
	}

	return summary
}

func UserFacingMessage(summary ErrorSummary) string {
	message := strings.TrimSpace(summary.UserMessage)
	if message == "" {
		message = "生成失败，请稍后重试。"
	}
	if summary.RequestID != "" {
		message = fmt.Sprintf("%s 请求ID：%s", message, summary.RequestID)
	}
	if summary.Code == "policy_blocked" && summary.Detail != "" {
		message = fmt.Sprintf("%s 返回内容：%s", message, Preview(summary.Detail, 80))
	}
	return message
}

func extractTextResponse(message string) string {
	marker := "文本响应:"
	idx := strings.Index(message, marker)
	if idx < 0 {
		return ""
	}
	text := strings.TrimSpace(message[idx+len(marker):])
	text = strings.TrimPrefix(text, "|")
	text = strings.TrimSpace(text)
	if cut := strings.Index(text, " | 安全警告:"); cut >= 0 {
		text = strings.TrimSpace(text[:cut])
	}
	return text
}
