package main

import (
	"image-gen-service/internal/model"
	"log"
)

func main() {
	model.InitDB("storage/local/service.db")

	config := model.ProviderConfig{
		ProviderName:   "gemini",
		DisplayName:    "Google Gemini",
		APIBase:        "https://generativelanguage.googleapis.com",
		APIKey:         "YOUR_API_KEY_HERE", // 用户需要替换为自己的 API Key
		Models:         `[{"id": "gemini-2.0-flash-exp", "name": "Gemini 2.0 Flash (Native)", "default": true}, {"id": "imagen-3.0-generate-001", "name": "Imagen 3.0"}]`,
		Enabled:        true,
		TimeoutSeconds: 500,
		MaxRetries:     3,
	}

	err := model.DB.Where(model.ProviderConfig{ProviderName: "gemini"}).FirstOrCreate(&config).Error
	if err != nil {
		log.Fatalf("初始化配置失败: %v", err)
	}

	openAIConfig := model.ProviderConfig{
		ProviderName:   "openai",
		DisplayName:    "OpenAI Compatible",
		APIBase:        "https://api.openai.com/v1",
		APIKey:         "YOUR_API_KEY_HERE",
		Models:         `[{"id": "gpt-image-1", "name": "gpt-image-1", "default": true}]`,
		Enabled:        true,
		TimeoutSeconds: 500,
		MaxRetries:     3,
	}

	if err := model.DB.Where(model.ProviderConfig{ProviderName: "openai"}).FirstOrCreate(&openAIConfig).Error; err != nil {
		log.Fatalf("初始化 OpenAI 配置失败: %v", err)
	}

	log.Println("默认 Gemini/OpenAI 配置已初始化")
}
