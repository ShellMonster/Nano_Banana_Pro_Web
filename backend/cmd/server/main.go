package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"image-gen-service/internal/api"
	"image-gen-service/internal/config"
	"image-gen-service/internal/model"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/storage"
	"image-gen-service/internal/templates"
	"image-gen-service/internal/worker"

	"github.com/gin-gonic/gin"
)

func getWorkDir() string {
	// 如果是作为 Tauri 边车运行，使用用户目录下的应用支持目录
	if os.Getenv("TAURI_PLATFORM") != "" || os.Getenv("TAURI_FAMILY") != "" {
		configDir, err := os.UserConfigDir()
		if err == nil {
			appDir := configDir + "/com.dztool.banana"
			_ = os.MkdirAll(appDir, 0755)
			return appDir
		}
	}
	return "."
}

func main() {
	workDir := getWorkDir()
	log.Printf("Working directory: %s", workDir)
	_ = os.Chdir(workDir)

	// 1. 初始化配置
	config.InitConfig()

	// 2. 初始化数据库
	model.InitDB(config.GlobalConfig.Database.Path)

	// 3. 初始化存储
	var ossConfig map[string]string
	if config.GlobalConfig.Storage.OSS.Enabled {
		ossConfig = map[string]string{
			"endpoint":        config.GlobalConfig.Storage.OSS.Endpoint,
			"accessKeyID":     config.GlobalConfig.Storage.OSS.AccessKeyID,
			"accessKeySecret": config.GlobalConfig.Storage.OSS.AccessKeySecret,
			"bucketName":      config.GlobalConfig.Storage.OSS.BucketName,
			"domain":          config.GlobalConfig.Storage.OSS.Domain,
		}
	}
	storage.InitStorage(config.GlobalConfig.Storage.LocalDir, ossConfig)

	// 3.5 初始化模板市场
	templates.InitStore(templates.Options{
		RemoteURL: config.GlobalConfig.Templates.RemoteURL,
		CachePath: filepath.Join(workDir, "templates_cache.json"),
		Timeout:   time.Duration(config.GlobalConfig.Templates.FetchTimeoutSeconds) * time.Second,
	})

	// 4. 初始化 Worker 池 (2C2G 服务器，推荐 6 个 worker)
	worker.InitPool(6, 100)
	worker.Pool.Start()

	// 5. 注册 Provider
	provider.InitProviders()

	// 5. 设置路由
	r := gin.Default()

	// 允许跨域请求
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		log.Printf("[CORS] Request from Origin: %s, Method: %s, Path: %s", origin, c.Request.Method, c.Request.URL.Path)

		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, *")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	v1 := r.Group("/api/v1")
	{
		v1.GET("/health", func(c *gin.Context) {
			api.Success(c, gin.H{"status": "ok"})
		})
		v1.GET("/templates", api.ListTemplatesHandler)
		v1.GET("/providers", api.ListProvidersHandler)
		v1.POST("/providers/config", api.UpdateProviderConfigHandler)
		v1.POST("/prompts/optimize", api.OptimizePromptHandler)
		v1.POST("/tasks/generate", api.GenerateHandler)
		v1.POST("/tasks/generate-with-images", api.GenerateWithImagesHandler)
		v1.GET("/tasks/:task_id", api.GetTaskHandler)
		v1.GET("/images", api.ListImagesHandler)
		v1.DELETE("/images/:id", api.DeleteImageHandler)
		v1.GET("/images/:id/download", api.DownloadImageHandler)
	}

	// 静态资源访问 (将 storage 目录整体暴露，以匹配数据库中的 storage/local/xxx.jpg 路径)
	// 针对本地存储增加缓存头，优化前端加载性能
	r.Group("/storage", func(c *gin.Context) {
		c.Header("Cache-Control", "public, max-age=31536000") // 1年缓存，因为本地文件路径通常包含唯一 ID
		c.Next()
	}).Static("", "storage")

	// 6. 端口探测与启动
	port := 8080
	var ln net.Listener
	var err error

	log.Printf("Starting port discovery from %d...", port)

	// 尝试从 8080 开始寻找可用端口
	// 强制绑定到 127.0.0.1 避免 macOS 沙盒拦截 0.0.0.0
	for i := 0; i < 100; i++ {
		addr := "127.0.0.1:" + strconv.Itoa(port+i)
		ln, err = net.Listen("tcp", addr)
		if err == nil {
			port = port + i
			break
		}
		log.Printf("Port %d is busy, trying next...", port+i)
	}

	if err != nil {
		log.Fatalf("Fatal: Could not find any available port: %v", err)
	}

	log.Printf("Successfully bound to 127.0.0.1:%d", port)

	// 如果是在 Tauri 边车模式下，将实际监听的端口打印到标准输出，方便前端发现
	fmt.Printf("SERVER_PORT=%d\n", port)
	os.Stdout.Sync()

	// 监听标准输入，用于检测父进程是否退出
	// 当 Tauri 进程退出时，它会自动关闭 sidecar 的 stdin，从而触发这里的 Read 返回
	go func() {
		buf := make([]byte, 1)
		for {
			_, err := os.Stdin.Read(buf)
			if err != nil {
				log.Printf("检测到标准输入关闭或异常 (%v)，正在安全退出...", err)
				// 发送退出信号
				p, _ := os.FindProcess(os.Getpid())
				p.Signal(syscall.SIGTERM)
				return
			}
		}
	}()

	srv := &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: r,
	}

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("启动服务失败: %v", err)
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务...")

	// 优雅停止 Worker 池
	worker.Pool.Stop()

	// 优雅停止 HTTP 服务
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("服务器强制关闭:", err)
	}

	log.Println("服务已安全退出")
}
