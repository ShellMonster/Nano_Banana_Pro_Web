package worker

import (
	"testing"
	"time"

	"image-gen-service/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFetchProviderTimeoutKeepsOpenAIImageConfig(t *testing.T) {
	originalDB := model.DB
	t.Cleanup(func() {
		model.DB = originalDB
	})

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := db.AutoMigrate(&model.ProviderConfig{}); err != nil {
		t.Fatalf("migrate provider config: %v", err)
	}
	model.DB = db

	configs := []model.ProviderConfig{
		{ProviderName: "openai", TimeoutSeconds: 150},
		{ProviderName: "openai-image", TimeoutSeconds: 500},
	}
	for _, cfg := range configs {
		if err := db.Create(&cfg).Error; err != nil {
			t.Fatalf("create provider config %s: %v", cfg.ProviderName, err)
		}
	}

	if got := fetchProviderTimeout("openai-image"); got != 500*time.Second {
		t.Fatalf("openai-image timeout = %s, want 500s", got)
	}
	if got := fetchProviderTimeout("openai"); got != 150*time.Second {
		t.Fatalf("openai timeout = %s, want 150s", got)
	}
}
