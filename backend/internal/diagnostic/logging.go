package diagnostic

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
)

func VerboseEnabled(params map[string]interface{}) bool {
	if params == nil {
		return false
	}
	for _, key := range []string{"_verbose_logging", "verbose_logging"} {
		if value, ok := params[key]; ok && toBool(value) {
			return true
		}
	}
	return false
}

func AttachVerboseFlag(params map[string]interface{}, enabled bool) {
	if params == nil {
		return
	}
	if enabled {
		params["_verbose_logging"] = true
	} else {
		delete(params, "_verbose_logging")
	}
}

func TaskID(params map[string]interface{}) string {
	if params == nil {
		return ""
	}
	for _, key := range []string{"_task_id", "task_id"} {
		if value, ok := params[key].(string); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func AttachTaskID(params map[string]interface{}, taskID string) {
	if params == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	params["_task_id"] = strings.TrimSpace(taskID)
}

func Logf(params map[string]interface{}, stage string, format string, args ...interface{}) {
	if !VerboseEnabled(params) {
		return
	}
	taskID := TaskID(params)
	prefix := "[Diag]"
	if taskID != "" {
		prefix = fmt.Sprintf("[Diag][task_id=%s]", taskID)
	}
	if stage != "" {
		prefix = fmt.Sprintf("%s[%s]", prefix, stage)
	}
	log.Printf("%s %s", prefix, fmt.Sprintf(format, args...))
}

func PromptHash(prompt string) string {
	sum := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(sum[:8])
}

func Preview(text string, maxRunes int) string {
	trimmed := strings.TrimSpace(text)
	if maxRunes <= 0 || trimmed == "" {
		return trimmed
	}
	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}
	return string(runes[:maxRunes]) + "...(truncated)"
}

func ExtractRequestID(text string) string {
	matches := requestIDPattern.FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}

func toBool(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		}
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	}
	return false
}
