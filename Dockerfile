# 多阶段构建 - 大香蕉 AI Docker 镜像
# 支持通过 Build Args 配置国内镜像源

# ========================================
# 镜像源配置参数
# ========================================
ARG DOCKER_REGISTRY=
ARG NPM_REGISTRY=
ARG GO_PROXY=

# ========================================
# Stage 1: 构建前端
# ========================================
ARG DOCKER_REGISTRY=
FROM ${DOCKER_REGISTRY:-}node:18-alpine AS frontend-builder

# npm 镜像源配置
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then \
        npm config set registry "$NPM_REGISTRY"; \
    fi

WORKDIR /frontend

# 复制 package 文件并安装依赖
COPY frontend/package*.json ./
RUN npm ci --production=false

# 复制源码并构建
COPY frontend/ ./
RUN npm run build

# ========================================
# Stage 2: 构建后端
# ========================================
ARG DOCKER_REGISTRY=
FROM ${DOCKER_REGISTRY:-}golang:1.24-alpine AS backend-builder

# 安装构建依赖（SQLite 需要 CGO 和 gcc）
RUN apk add --no-cache \
    gcc \
    musl-dev \
    sqlite-dev \
    && rm -rf /var/cache/apk/*

# Go 模块代理配置
ARG GO_PROXY=
ENV GOPROXY=${GO_PROXY:-https://goproxy.cn,direct}

WORKDIR /backend

# 复制 go.mod 并下载依赖
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# 复制源码并构建
COPY backend/ ./
# 启用 CGO 以支持 SQLite
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# ========================================
# Stage 3: 最终运行镜像
# ========================================
ARG DOCKER_REGISTRY=
FROM ${DOCKER_REGISTRY:-}alpine:3.19

# 安装运行时依赖（包括 SQLite 动态库）
RUN apk add --no-cache \
    nginx \
    ca-certificates \
    tzdata \
    wget \
    sqlite-libs \
    && rm -rf /var/cache/apk/*

# 设置时区（可被环境变量覆盖）
ENV TZ=Asia/Shanghai

# 禁用标准输入监听（Docker/生产环境）
ENV DISABLE_STDIN_MONITOR=true

# 创建必要的目录
RUN mkdir -p /app/storage /app/frontend/dist /var/log/nginx /run/nginx /app/storage/local

# 复制后端二进制文件
COPY --from=backend-builder /backend/server /app/server

# 复制前端构建产物
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

# 复制 Nginx 配置
COPY docker/nginx.conf /etc/nginx/nginx.conf

# 复制默认配置文件（可被挂载覆盖）
COPY backend/configs/config.yaml /app/config.yaml

# 创建存储目录挂载点
VOLUME ["/app/storage"]

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/v1/health || wget -q --spider http://localhost:80/api/v1/health || exit 1

# 启动脚本：同时运行 Nginx 和后端服务
CMD sh -c "mkdir -p /app/storage/local && nginx && cd /app && ./server"
