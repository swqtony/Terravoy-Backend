#!/bin/bash
# TerraVoy Admin 后台部署脚本 (Staging)
# 使用方法: ./tools/deploy-admin.sh

set -e

# 配置
STAGING_HOST="39.105.212.81"
STAGING_USER="root"
SSH_KEY="$HOME/.ssh/terravoy-ecs.pem"
ADMIN_PATH="/opt/terravoy-admin"
BACKEND_PATH="/opt/terravoy-backend"
DB_CONTAINER="terravoy-db-staging"
DB_NAME="terravoy_staging"
DB_USER="postgres"
DB_PASSWORD="b58ba5133d84f92f8f94810cd32cb8c36cac7d0ba3dcfda9"
BACKEND_PORT="3100"
ADMIN_PORT="3200"
LOCAL_ADMIN_PATH="/mnt/c/wsl_projects/TerraVoy-Admin"
LOCAL_BUILD_TGZ="/tmp/terravoy-admin-build.tgz"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查 SSH 密钥
check_ssh_key() {
    if [[ ! -f "$SSH_KEY" ]]; then
        log_error "SSH 密钥未找到: $SSH_KEY"
        exit 1
    fi
    chmod 600 "$SSH_KEY" 2>/dev/null || true
}

# SSH 命令封装
ssh_cmd() {
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=30 "${STAGING_USER}@${STAGING_HOST}" "$@"
}

scp_cmd() {
    scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$@"
}

# 运行数据库迁移
run_migrations() {
    log_info "📦 运行 Admin 数据库迁移..."
    
    local migrations=(
        "0033_admin_auth.sql"
        "0034_admin_rbac_audit.sql"
        "0035_admin_phase3.sql"
        "0036_admin_host_cert_permissions.sql"
        "0037_admin_phase4_permissions.sql"
    )
    
    for migration in "${migrations[@]}"; do
        local file="$BACKEND_PATH/db/migrations/$migration"
        log_info "  运行: $migration"
        ssh_cmd "docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME < $file 2>&1 | grep -v 'already exists' | head -3 || true"
    done
    
    log_success "数据库迁移完成"
}

# 创建管理员用户
create_admin_user() {
    log_info "👤 创建/更新管理员用户..."
    
    local password_hash
    password_hash=$(node -e "const crypto=require('crypto'); const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync('admin123', salt, 64).toString('hex'); console.log('scrypt$'+salt+'$'+hash);")
    local password_hash_escaped=${password_hash//$/\\$}
    ssh_cmd "docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c \"\
INSERT INTO admin_users (email, password_hash, status)\
VALUES ('super_admin@terravoy.cn', '$password_hash_escaped', 'active')\
ON CONFLICT (email) DO UPDATE SET password_hash = '$password_hash_escaped', status = 'active';\
\""
    
    log_success "管理员用户: super_admin@terravoy.cn / admin123"
}

# 创建环境配置
create_env_config() {
    log_info "⚙️ 创建 .env.local 配置..."
    
    ssh_cmd "cat > $ADMIN_PATH/.env.local << 'EOF'
NEXT_PUBLIC_ADMIN_API_BASE=http://$STAGING_HOST:$BACKEND_PORT/functions/v1/admin
ADMIN_ACCESS_TOKEN_TTL_MIN=30
ADMIN_REFRESH_TOKEN_TTL_DAYS=30
ADMIN_COOKIE_SECURE=false
EOF"
    
    log_success "配置文件创建完成"
}

# 部署前自检：确认 admin 登录路由存在
preflight_check() {
    log_info "🔎 预检 backend admin 路由..."
    local status
    status=$(ssh_cmd "curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' http://localhost:$BACKEND_PORT/functions/v1/admin/auth/login")
    if [[ "$status" == "404" ]]; then
        log_error "admin 登录路由不存在 (HTTP 404)。检查 backend 端口/部署是否正确。"
        exit 1
    fi
    log_success "预检通过 (HTTP $status)"
}

# 构建 Admin (确保 NEXT_PUBLIC_* 生效)
build_admin() {
    log_info "🏗️ 构建 Admin..."
    if ssh_cmd "[[ -d $ADMIN_PATH/src || -d $ADMIN_PATH/app || -d $ADMIN_PATH/pages ]]"; then
        ssh_cmd "cd $ADMIN_PATH && npm run build"
        log_success "Admin 构建完成"
    else
        log_warn "未找到源码目录，尝试本地构建并上传产物..."
        if ! build_admin_local; then
            log_warn "本地构建不可用，跳过构建（仅重启使用现有构建产物）。"
            return 0
        fi
        deploy_admin_build
    fi
}

build_admin_local() {
    if [[ ! -d "$LOCAL_ADMIN_PATH" ]]; then
        log_warn "本地路径不存在: $LOCAL_ADMIN_PATH"
        return 1
    fi
    if [[ ! -f "$LOCAL_ADMIN_PATH/package.json" ]]; then
        log_warn "本地路径无 package.json: $LOCAL_ADMIN_PATH"
        return 1
    fi
    log_info "🏗️ 本地构建 Admin..."
    (cd "$LOCAL_ADMIN_PATH" && ADMIN_COOKIE_SECURE=false NEXT_PUBLIC_ADMIN_API_BASE="http://$STAGING_HOST:$BACKEND_PORT/functions/v1/admin" npm run build)
    local files=(.next package.json package-lock.json next.config.js)
    if [[ -d "$LOCAL_ADMIN_PATH/public" ]]; then
        files+=(public)
    fi
    tar -czf "$LOCAL_BUILD_TGZ" -C "$LOCAL_ADMIN_PATH" "${files[@]}"
    log_success "本地构建完成"
    return 0
}

deploy_admin_build() {
    log_info "🚀 上传 Admin 构建产物..."
    scp_cmd "$LOCAL_BUILD_TGZ" "${STAGING_USER}@${STAGING_HOST}:$ADMIN_PATH/terravoy-admin-build.tgz"
    ssh_cmd "cd $ADMIN_PATH && tar -xzf terravoy-admin-build.tgz && rm -f terravoy-admin-build.tgz"
    log_success "构建产物上传完成"
}

# 重启 Admin 服务
restart_admin() {
    log_info "🔄 重启 Admin 服务..."
    
    # 停止旧进程
    ssh_cmd "fuser -k $ADMIN_PORT/tcp 2>/dev/null || true"
    sleep 2
    
    # 启动服务
    ssh_cmd "cd $ADMIN_PATH && bash -lc 'set -a; [ -f .env.local ] && source .env.local; set +a; nohup node node_modules/next/dist/bin/next start -p $ADMIN_PORT > /var/log/terravoy-admin.log 2>&1 &'"
    sleep 5
    
    # 验证
    if ssh_cmd "curl -sf -m 5 http://localhost:$ADMIN_PORT" | grep -q "TerraVoy"; then
        log_success "Admin 服务启动成功"
    else
        log_warn "服务可能还在启动中，请稍后检查"
        ssh_cmd "tail -10 /var/log/terravoy-admin.log"
    fi
}

# 验证健康状态
verify_health() {
    log_info "🏥 验证服务状态..."
    
    echo -n "  Admin ($ADMIN_PORT): "
    if ssh_cmd "curl -sf http://localhost:$ADMIN_PORT" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
    
    echo -n "  数据库连接:   "
    if ssh_cmd "docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c 'SELECT 1'" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
}

# 显示登录信息
show_login_info() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║           Admin 后台已部署完成                 ║"
    echo "╠═══════════════════════════════════════════════╣"
    echo "║  网址: http://$STAGING_HOST:$ADMIN_PORT           ║"
    echo "║  邮箱: super_admin@terravoy.cn                ║"
    echo "║  密码: admin123                               ║"
    echo "╚═══════════════════════════════════════════════╝"
}

# 主流程
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════╗"
    echo "║   TerraVoy Admin 部署脚本 (Staging)            ║"
    echo "║   Target: ${STAGING_HOST}:${ADMIN_PORT}                    ║"
    echo "╚═══════════════════════════════════════════════╝"
    echo ""

    check_ssh_key
    
    echo "请选择操作:"
    echo "  1) 完整部署 (迁移 + 用户 + 配置 + 重启)"
    echo "  2) 仅重启服务"
    echo "  3) 仅运行迁移"
    echo "  4) 仅创建管理员用户"
    read -rp "选择 [1-4]: " choice
    
    case $choice in
        1)
            run_migrations
            create_admin_user
            create_env_config
            preflight_check
            build_admin
            restart_admin
            ;;
        2)
            restart_admin
            ;;
        3)
            run_migrations
            ;;
        4)
            create_admin_user
            ;;
        *)
            log_error "无效选择"
            exit 1
            ;;
    esac
    
    echo ""
    verify_health
    show_login_info
}

main "$@"
