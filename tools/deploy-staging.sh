#!/bin/bash
# TerraVoy 后端一键部署脚本 (Staging)
# 使用方法: ./tools/deploy-staging.sh

set -e

# 配置
STAGING_HOST="39.105.212.81"
STAGING_USER="root"
SSH_KEY="$HOME/.ssh/terravoy-ecs.pem"
REMOTE_PATH="/opt/terravoy-backend"
LOCAL_PATH="$(dirname "$0")/.."

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查 SSH 密钥
check_ssh_key() {
    if [[ ! -f "$SSH_KEY" ]]; then
        log_error "SSH 密钥未找到: $SSH_KEY"
        log_info "请复制密钥到: $SSH_KEY"
        log_info "例如: cp /mnt/c/wsl_projects/terravoy-ecs.pem $SSH_KEY && chmod 600 $SSH_KEY"
        exit 1
    fi
    chmod 600 "$SSH_KEY" 2>/dev/null || true
}

# SSH 命令封装
ssh_cmd() {
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "${STAGING_USER}@${STAGING_HOST}" "$@"
}

# 同步代码
sync_code() {
    log_info "📦 同步代码到 staging..."
    rsync -avz --progress \
        -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude '*.log' \
        --exclude '.env' \
        "$LOCAL_PATH/" "${STAGING_USER}@${STAGING_HOST}:${REMOTE_PATH}/"
    log_success "代码同步完成"
}

# 重建主后端
rebuild_api() {
    log_info "🔨 重建主后端 (api, worker)..."
    ssh_cmd "cd $REMOTE_PATH && docker compose up -d --build api worker"
    log_success "主后端重建完成"
}

run_migrations() {
    log_info "🧩 检查数据库迁移..."
    if ssh_cmd "cd $REMOTE_PATH && docker compose exec -T api npm run db:migrate -- --dry-run" | grep -q 'No pending migrations'; then
        log_success "无需迁移"
        return
    fi
    log_info "运行迁移..."
    ssh_cmd "cd $REMOTE_PATH && docker compose exec -T api npm run db:migrate"
    log_success "迁移完成"
}

# 重建 IM 服务
rebuild_im() {
    log_info "🔨 重建 IM 服务 (im-api, im-gateway, im-worker)..."
    
    # 检查关键配置
    log_info "检查 .env.staging 配置..."
    local missing=""
    if ! ssh_cmd "grep -q '^IM_DB_DSN=' $REMOTE_PATH/.env.staging 2>/dev/null"; then
        missing="$missing IM_DB_DSN"
    elif ssh_cmd "grep -q '^IM_DB_DSN=$' $REMOTE_PATH/.env.staging 2>/dev/null"; then
        missing="$missing IM_DB_DSN"
    fi
    if ! ssh_cmd "grep -q '^AUTH_JWT_SECRET=' $REMOTE_PATH/.env.staging 2>/dev/null"; then
        missing="$missing AUTH_JWT_SECRET"
    elif ssh_cmd "grep -q '^AUTH_JWT_SECRET=$' $REMOTE_PATH/.env.staging 2>/dev/null"; then
        missing="$missing AUTH_JWT_SECRET"
    fi
    if [[ -n "$missing" ]]; then
        log_warn "缺少或配置错误:$missing"
        log_warn "请检查 .env.staging 文件，参考 .env.staging.example"
    fi
    
    # 使用 .env.staging 启动 IM 服务
    ssh_cmd "cd $REMOTE_PATH && docker compose -f im/docker-compose.im.yml --env-file .env.staging up -d --build im-api im-gateway im-worker"
    
    # 确保 IM 容器加入主后端网络
    log_info "连接 IM 容器到主后端网络..."
    ssh_cmd "docker network connect terravoy-backend_default terravoy-im-api 2>/dev/null || true"
    ssh_cmd "docker network connect terravoy-backend_default terravoy-im-gateway 2>/dev/null || true"
    
    log_success "IM 服务重建完成"
}

# 验证健康状态
verify_health() {
    log_info "🏥 验证服务健康状态..."
    
    echo -n "  主后端 API (3100): "
    if ssh_cmd "curl -sf http://localhost:3100/health" | grep -q '"ok":true'; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
    
    echo -n "  IM API (8090):     "
    if ssh_cmd "curl -sf http://localhost:8090/health" | grep -q '"ok":true'; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
}

# 显示容器状态
show_status() {
    log_info "📊 容器状态:"
    ssh_cmd "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'terravoy|im-' | head -10"
}

# 主流程
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║   TerraVoy 后端部署脚本 (Staging)             ║"
    echo "║   Target: ${STAGING_HOST}                     ║"
    echo "╚═══════════════════════════════════════════════╝"
    echo ""

    check_ssh_key
    
    # 询问部署范围
    echo "请选择部署范围:"
    echo "  1) 仅主后端 (api, worker)"
    echo "  2) 仅 IM 服务 (im-api, im-gateway, im-worker)"
    echo "  3) 全部服务 (推荐)"
    echo "  4) 仅同步代码 (不重建)"
    read -rp "选择 [1-4]: " choice
    
    case $choice in
        1)
            sync_code
            rebuild_api
            read -rp "是否运行数据库迁移？(y/N): " run_migrate
            if [[ "$run_migrate" =~ ^[Yy]$ ]]; then
                run_migrations
            fi
            ;;
        2)
            sync_code
            rebuild_im
            ;;
        3)
            sync_code
            rebuild_api
            rebuild_im
            read -rp "是否运行数据库迁移？(y/N): " run_migrate
            if [[ "$run_migrate" =~ ^[Yy]$ ]]; then
                run_migrations
            fi
            ;;
        4)
            sync_code
            ;;
        *)
            log_error "无效选择"
            exit 1
            ;;
    esac
    
    echo ""
    verify_health
    echo ""
    show_status
    
    echo ""
    log_success "🎉 部署完成!"
}

main "$@"
