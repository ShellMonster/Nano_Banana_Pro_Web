package api

import "github.com/gin-gonic/gin"

// ListProviderConfigsHandler returns provider configs (alias of ListProvidersHandler).
func ListProviderConfigsHandler(c *gin.Context) {
	ListProvidersHandler(c)
}
