package api

import (
	"strings"

	"image-gen-service/internal/templates"

	"github.com/gin-gonic/gin"
)

// ListTemplatesHandler 返回模板市场数据
func ListTemplatesHandler(c *gin.Context) {
	payload := templates.GetTemplates()
	q := strings.TrimSpace(c.Query("q"))
	channel := strings.TrimSpace(c.Query("channel"))
	material := strings.TrimSpace(c.Query("material"))
	industry := strings.TrimSpace(c.Query("industry"))
	ratio := strings.TrimSpace(c.Query("ratio"))

	items := templates.FilterItems(payload.Items, q, channel, material, industry, ratio)

	Success(c, gin.H{
		"meta":  payload.Meta,
		"items": items,
	})
}
