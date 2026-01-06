package config

import (
	"log"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Server struct {
		Port int `mapstructure:"port"`
	} `mapstructure:"server"`
	Database struct {
		Path string `mapstructure:"path"`
	} `mapstructure:"database"`
	Storage struct {
		LocalDir string `mapstructure:"local_dir"`
		OSS      struct {
			Enabled         bool   `mapstructure:"enabled"`
			Endpoint        string `mapstructure:"endpoint"`
			AccessKeyID     string `mapstructure:"access_key_id"`
			AccessKeySecret string `mapstructure:"access_key_secret"`
			BucketName      string `mapstructure:"bucket_name"`
			Domain          string `mapstructure:"domain"`
		} `mapstructure:"oss"`
	} `mapstructure:"storage"`
	Providers map[string]struct {
		APIKey  string `mapstructure:"api_key"`
		APIBase string `mapstructure:"api_base"`
		Enabled bool   `mapstructure:"enabled"`
	} `mapstructure:"providers"`
}

var GlobalConfig Config

func InitConfig() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("configs")
	viper.AddConfigPath(".")

	// 设置默认值
	viper.SetDefault("database.path", "data.db")
	viper.SetDefault("storage.local_dir", "storage")
	viper.SetDefault("server.port", 8080)

	// 支持环境变量
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		log.Printf("未找到配置文件，将使用环境变量或默认值: %v", err)
	}

	if err := viper.Unmarshal(&GlobalConfig); err != nil {
		log.Fatalf("解析配置失败: %v", err)
	}
}
