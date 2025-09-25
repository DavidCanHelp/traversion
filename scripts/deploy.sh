#!/bin/bash

###############################################################################
# Production Deployment Script for Traversion
#
# This script handles production deployments with health checks, rollback
# capability, and zero-downtime deployment.
###############################################################################

set -e  # Exit on error

# Configuration
DEPLOYMENT_ID="dep_$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 4)"
DEPLOYMENT_DIR="/opt/traversion"
BACKUP_DIR="/var/backups/traversion"
LOG_FILE="/var/log/traversion/deployment_${DEPLOYMENT_ID}.log"
HEALTH_CHECK_URL="http://localhost:3335/api/health/ready"
ROLLBACK_MARKER="${DEPLOYMENT_DIR}/.last_good_deployment"
MAX_HEALTH_RETRIES=30
HEALTH_CHECK_INTERVAL=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "${LOG_FILE}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "${LOG_FILE}"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "${LOG_FILE}"
}

# Check if running as appropriate user
check_user() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root"
        exit 1
    fi
}

# Pre-deployment checks
pre_deployment_checks() {
    log "Running pre-deployment checks..."

    # Check if Docker is running
    if ! docker info > /dev/null 2>&1; then
        error "Docker is not running"
        exit 1
    fi

    # Check if required files exist
    if [[ ! -f ".env.production" ]]; then
        error ".env.production file not found"
        exit 1
    fi

    if [[ ! -f "docker-compose.production.yml" ]]; then
        error "docker-compose.production.yml file not found"
        exit 1
    fi

    # Check disk space
    available_space=$(df / | awk 'NR==2 {print $4}')
    if [[ $available_space -lt 1000000 ]]; then
        error "Insufficient disk space (less than 1GB available)"
        exit 1
    fi

    # Check if backup directory exists
    mkdir -p "${BACKUP_DIR}"
    mkdir -p "$(dirname "${LOG_FILE}")"

    log "Pre-deployment checks passed"
}

# Backup current deployment
backup_deployment() {
    log "Creating backup of current deployment..."

    local backup_file="${BACKUP_DIR}/traversion_backup_${DEPLOYMENT_ID}.tar.gz"

    if [[ -d "${DEPLOYMENT_DIR}" ]]; then
        # Stop services to ensure consistent backup
        docker-compose -f docker-compose.production.yml stop || true

        # Create backup
        tar -czf "${backup_file}" \
            -C "${DEPLOYMENT_DIR}" \
            --exclude='node_modules' \
            --exclude='*.log' \
            --exclude='.git' \
            .

        log "Backup created: ${backup_file}"

        # Keep only last 5 backups
        ls -t "${BACKUP_DIR}"/traversion_backup_*.tar.gz | tail -n +6 | xargs -r rm

        # Restart services
        docker-compose -f docker-compose.production.yml start || true
    else
        warning "No existing deployment to backup"
    fi
}

# Build Docker image
build_image() {
    log "Building Docker image..."

    # Build with production optimizations
    docker build \
        --build-arg NODE_ENV=production \
        --tag traversion:latest \
        --tag "traversion:${DEPLOYMENT_ID}" \
        --file Dockerfile \
        --no-cache \
        .

    if [[ $? -ne 0 ]]; then
        error "Docker build failed"
        exit 1
    fi

    log "Docker image built successfully"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."

    docker-compose -f docker-compose.production.yml run --rm \
        traversion node -e "
            import('./src/database/migrations.js').then(async (m) => {
                const runner = new m.MigrationRunner();
                await runner.initialize();
                const result = await runner.migrate();
                console.log('Migrations applied:', result.migrated);
                runner.close();
            });
        "

    if [[ $? -ne 0 ]]; then
        error "Database migrations failed"
        rollback
        exit 1
    fi

    log "Database migrations completed"
}

# Deploy new version
deploy() {
    log "Deploying new version..."

    # Stop current deployment
    docker-compose -f docker-compose.production.yml down

    # Start new deployment
    docker-compose -f docker-compose.production.yml up -d

    if [[ $? -ne 0 ]]; then
        error "Deployment failed"
        rollback
        exit 1
    fi

    log "New version deployed"
}

# Health check
health_check() {
    log "Running health checks..."

    local retries=0

    while [[ $retries -lt $MAX_HEALTH_RETRIES ]]; do
        sleep $HEALTH_CHECK_INTERVAL

        if curl -f -s "${HEALTH_CHECK_URL}" > /dev/null; then
            log "Health check passed"

            # Additional checks
            local detailed_health=$(curl -s "http://localhost:3335/api/health/detailed")
            local overall_status=$(echo "$detailed_health" | jq -r '.status')

            if [[ "$overall_status" == "healthy" ]] || [[ "$overall_status" == "degraded" ]]; then
                log "Application is ${overall_status}"
                return 0
            else
                warning "Application status: ${overall_status}"
            fi
        fi

        retries=$((retries + 1))
        warning "Health check attempt ${retries}/${MAX_HEALTH_RETRIES} failed"
    done

    error "Health checks failed after ${MAX_HEALTH_RETRIES} attempts"
    return 1
}

# Smoke tests
run_smoke_tests() {
    log "Running smoke tests..."

    # Test main API endpoint
    if ! curl -f -s "http://localhost:3333/api/timeline" > /dev/null; then
        error "API smoke test failed"
        return 1
    fi

    # Test WebSocket connection
    if ! timeout 5 bash -c 'cat < /dev/null > /dev/tcp/localhost/3341'; then
        error "WebSocket smoke test failed"
        return 1
    fi

    # Test web interface
    if ! curl -f -s "http://localhost:3335" > /dev/null; then
        error "Web interface smoke test failed"
        return 1
    fi

    log "Smoke tests passed"
    return 0
}

# Rollback deployment
rollback() {
    error "Initiating rollback..."

    if [[ -f "${ROLLBACK_MARKER}" ]]; then
        local last_good_deployment=$(cat "${ROLLBACK_MARKER}")
        local backup_file="${BACKUP_DIR}/traversion_backup_${last_good_deployment}.tar.gz"

        if [[ -f "${backup_file}" ]]; then
            log "Rolling back to deployment: ${last_good_deployment}"

            # Stop current deployment
            docker-compose -f docker-compose.production.yml down

            # Restore backup
            rm -rf "${DEPLOYMENT_DIR}"
            mkdir -p "${DEPLOYMENT_DIR}"
            tar -xzf "${backup_file}" -C "${DEPLOYMENT_DIR}"

            # Restart with previous version
            cd "${DEPLOYMENT_DIR}"
            docker-compose -f docker-compose.production.yml up -d

            if health_check; then
                log "Rollback completed successfully"
                exit 0
            else
                error "Rollback failed - manual intervention required"
                exit 1
            fi
        else
            error "Backup file not found: ${backup_file}"
        fi
    else
        error "No previous deployment marker found"
    fi

    error "Rollback failed"
    exit 1
}

# Mark deployment as successful
mark_success() {
    echo "${DEPLOYMENT_ID}" > "${ROLLBACK_MARKER}"
    log "Deployment marked as successful: ${DEPLOYMENT_ID}"
}

# Send notification
send_notification() {
    local status=$1
    local message=$2

    # Send to monitoring service
    if [[ -n "${DATADOG_API_KEY}" ]]; then
        curl -X POST "https://api.datadoghq.com/api/v1/events?api_key=${DATADOG_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{
                \"title\": \"Traversion Deployment ${status}\",
                \"text\": \"${message}\",
                \"priority\": \"normal\",
                \"tags\": [\"deployment:${DEPLOYMENT_ID}\", \"environment:production\"],
                \"alert_type\": \"${status}\"
            }" > /dev/null 2>&1
    fi

    # Send to Slack
    if [[ -n "${SLACK_WEBHOOK_URL}" ]]; then
        local color="good"
        [[ "$status" == "error" ]] && color="danger"
        [[ "$status" == "warning" ]] && color="warning"

        curl -X POST "${SLACK_WEBHOOK_URL}" \
            -H "Content-Type: application/json" \
            -d "{
                \"attachments\": [{
                    \"color\": \"${color}\",
                    \"title\": \"Traversion Deployment ${status}\",
                    \"text\": \"${message}\",
                    \"footer\": \"Deployment ID: ${DEPLOYMENT_ID}\",
                    \"ts\": $(date +%s)
                }]
            }" > /dev/null 2>&1
    fi
}

# Clean up old resources
cleanup() {
    log "Cleaning up old resources..."

    # Remove old Docker images
    docker image prune -af --filter "until=168h" > /dev/null 2>&1

    # Clean up old logs
    find /var/log/traversion -name "*.log" -mtime +30 -delete

    log "Cleanup completed"
}

# Main deployment flow
main() {
    log "Starting deployment ${DEPLOYMENT_ID}"
    send_notification "info" "Deployment ${DEPLOYMENT_ID} started"

    # Run deployment steps
    check_user
    pre_deployment_checks
    backup_deployment
    build_image
    run_migrations
    deploy

    # Verify deployment
    if health_check && run_smoke_tests; then
        mark_success
        cleanup
        log "Deployment ${DEPLOYMENT_ID} completed successfully"
        send_notification "success" "Deployment ${DEPLOYMENT_ID} completed successfully"
        exit 0
    else
        error "Deployment verification failed"
        send_notification "error" "Deployment ${DEPLOYMENT_ID} failed - rollback initiated"
        rollback
        exit 1
    fi
}

# Handle interrupts
trap 'error "Deployment interrupted"; rollback' INT TERM

# Run main function
main "$@"