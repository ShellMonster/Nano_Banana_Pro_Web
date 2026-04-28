package worker

import (
	"context"
	"strings"
	"testing"
	"time"

	"image-gen-service/internal/model"
	"image-gen-service/internal/provider"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type blockingProvider struct {
	name     string
	started  chan struct{}
	release  chan struct{}
	finished chan struct{}
}

type panicProvider struct {
	name string
}

func (p *blockingProvider) Name() string { return p.name }

func (p *blockingProvider) Generate(ctx context.Context, params map[string]interface{}) (*provider.ProviderResult, error) {
	close(p.started)
	<-p.release
	close(p.finished)
	return &provider.ProviderResult{}, nil
}

func (p *blockingProvider) ValidateParams(params map[string]interface{}) error { return nil }

func (p *panicProvider) Name() string { return p.name }

func (p *panicProvider) Generate(ctx context.Context, params map[string]interface{}) (*provider.ProviderResult, error) {
	panic("provider exploded")
}

func (p *panicProvider) ValidateParams(params map[string]interface{}) error { return nil }

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

func TestProcessTaskWaitsForProviderCallBeforeRecordingTimeout(t *testing.T) {
	originalDB := model.DB
	t.Cleanup(func() {
		model.DB = originalDB
	})

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := db.AutoMigrate(&model.ProviderConfig{}, &model.Task{}); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	model.DB = db

	providerName := "timeout-test-provider"
	if err := db.Create(&model.ProviderConfig{ProviderName: providerName, TimeoutSeconds: 1}).Error; err != nil {
		t.Fatalf("create provider config: %v", err)
	}

	fakeProvider := &blockingProvider{
		name:     providerName,
		started:  make(chan struct{}),
		release:  make(chan struct{}),
		finished: make(chan struct{}),
	}
	provider.Register(fakeProvider)

	taskModel := model.Task{
		TaskID:       "timeout-task",
		Prompt:       "draw a banana",
		ProviderName: providerName,
		ModelID:      "test-model",
		Status:       "pending",
		TotalCount:   1,
	}
	if err := db.Create(&taskModel).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	poolCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	wp := &WorkerPool{ctx: poolCtx, cancel: cancel}

	processDone := make(chan struct{})
	go func() {
		wp.processTask(&Task{TaskModel: &taskModel, Params: map[string]interface{}{}})
		close(processDone)
	}()

	select {
	case <-fakeProvider.started:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("provider Generate did not start")
	}

	select {
	case <-processDone:
		t.Fatal("processTask returned before provider Generate finished")
	case <-time.After(1100 * time.Millisecond):
	}

	close(fakeProvider.release)

	select {
	case <-processDone:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("processTask did not finish after provider Generate returned")
	}

	select {
	case <-fakeProvider.finished:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("provider Generate did not finish")
	}

	var saved model.Task
	if err := db.Where("task_id = ?", taskModel.TaskID).First(&saved).Error; err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if saved.Status != "failed" {
		t.Fatalf("task status = %q, want failed", saved.Status)
	}
	if !strings.Contains(saved.ErrorMessage, "生成超时(1s)") {
		t.Fatalf("task error = %q, want generation timeout", saved.ErrorMessage)
	}
}

func TestProcessTaskRecordsProviderPanicAsFailure(t *testing.T) {
	originalDB := model.DB
	t.Cleanup(func() {
		model.DB = originalDB
	})

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := db.AutoMigrate(&model.ProviderConfig{}, &model.Task{}); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	model.DB = db

	providerName := "panic-test-provider"
	if err := db.Create(&model.ProviderConfig{ProviderName: providerName, TimeoutSeconds: 1}).Error; err != nil {
		t.Fatalf("create provider config: %v", err)
	}
	provider.Register(&panicProvider{name: providerName})

	taskModel := model.Task{
		TaskID:       "panic-task",
		Prompt:       "draw a banana",
		ProviderName: providerName,
		ModelID:      "test-model",
		Status:       "pending",
		TotalCount:   1,
	}
	if err := db.Create(&taskModel).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	poolCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	wp := &WorkerPool{ctx: poolCtx, cancel: cancel}
	wp.processTask(&Task{TaskModel: &taskModel, Params: map[string]interface{}{}})

	var saved model.Task
	if err := db.Where("task_id = ?", taskModel.TaskID).First(&saved).Error; err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if saved.Status != "failed" {
		t.Fatalf("task status = %q, want failed", saved.Status)
	}
	if !strings.Contains(saved.ErrorMessage, "Provider 执行异常崩溃: provider exploded") {
		t.Fatalf("task error = %q, want provider panic failure", saved.ErrorMessage)
	}
}
