# Production Deployment Guide

## Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04+ or RHEL 8+
- **CPU**: 4+ cores recommended
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 50GB minimum for application and logs
- **Docker**: 20.10+ with Docker Compose 2.0+
- **Node.js**: 18+ (for migrations and CLI tools)

### Network Requirements
- Ports 80/443 for web traffic
- Port 3335 for web interface (can be proxied)
- Port 3333 for API (can be proxied)
- Port 3341 for WebSocket connections
- Port 5432 for PostgreSQL (internal)
- Port 6379 for Redis (internal)

## Quick Start

### 1. Initial Setup

```bash
# Clone the repository
git clone https://github.com/your-org/traversion.git
cd traversion

# Copy and configure environment
cp .env.production .env.production.local
# Edit .env.production.local with your values

# Generate secure secrets
openssl rand -base64 64 | tr -d '\n'  # For JWT_SECRET
openssl rand -base64 64 | tr -d '\n'  # For SESSION_SECRET
```

### 2. Deploy with Docker

```bash
# Build and start services
docker-compose -f docker-compose.production.yml up -d

# Check status
docker-compose -f docker-compose.production.yml ps

# View logs
docker-compose -f docker-compose.production.yml logs -f
```

### 3. Run Migrations

```bash
# Initialize database
docker-compose -f docker-compose.production.yml exec traversion \
  node -e "import('./src/database/migrations.js').then(m => new m.MigrationCLI().run('migrate'))"
```

### 4. Verify Deployment

```bash
# Health check
curl http://localhost:3335/api/health/detailed

# View status page
open http://localhost:3335/api/status
```

## Automated Deployment

Use the provided deployment script for zero-downtime deployments:

```bash
# Make script executable
chmod +x scripts/deploy.sh

# Run deployment
./scripts/deploy.sh

# The script will:
# - Run pre-deployment checks
# - Create backup of current deployment
# - Build new Docker image
# - Run database migrations
# - Deploy new version
# - Run health checks
# - Rollback automatically if checks fail
```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret (64+ chars) | Random string |
| `SESSION_SECRET` | Session encryption secret | Random string |
| `POSTGRES_PASSWORD` | Database password | Strong password |
| `REDIS_PASSWORD` | Redis cache password | Strong password |
| `GITHUB_TOKEN` | GitHub API token | `ghp_xxx` |

### Feature Flags

Control features via environment variables:

```bash
FEATURE_AUTO_ROLLBACK=true      # Enable automatic rollback generation
FEATURE_ML_PREDICTIONS=true     # Enable machine learning predictions
FEATURE_REALTIME_TRACKING=true  # Enable real-time deployment tracking
FEATURE_FEEDBACK_LOOP=true      # Enable feedback learning system
```

### Security Configuration

```bash
# Production security settings
COOKIE_SECURE=true              # HTTPS-only cookies
CSRF_ENABLED=true               # CSRF protection
RATE_LIMIT_MAX=100              # Requests per window
BCRYPT_ROUNDS=12                # Password hashing rounds
```

## Monitoring

### Health Endpoints

- `/api/health` - Basic health check (200/503)
- `/api/health/live` - Kubernetes liveness probe
- `/api/health/ready` - Kubernetes readiness probe
- `/api/health/detailed` - Comprehensive health check
- `/api/metrics` - Prometheus metrics
- `/api/status` - HTML status page

### Metrics Collection

Prometheus metrics available at `/api/metrics`:
- Request count and errors
- Response latency
- Memory usage
- CPU usage
- Custom application metrics

### Logging

Logs are stored in `/var/log/traversion/`:
- `application.log` - Application logs
- `error.log` - Error logs
- `deployment_*.log` - Deployment logs
- `audit.log` - Security audit trail

Configure log rotation:

```bash
# /etc/logrotate.d/traversion
/var/log/traversion/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 traversion traversion
    sharedscripts
    postrotate
        docker-compose -f /opt/traversion/docker-compose.production.yml restart traversion
    endscript
}
```

## Database Management

### Migrations

```bash
# Check migration status
node -e "import('./src/database/migrations.js').then(m => new m.MigrationCLI().run('status'))"

# Create new migration
node -e "import('./src/database/migrations.js').then(m => new m.MigrationCLI().run('create', 'add_new_feature'))"

# Run pending migrations
node -e "import('./src/database/migrations.js').then(m => new m.MigrationCLI().run('migrate'))"

# Rollback last migration
node -e "import('./src/database/migrations.js').then(m => new m.MigrationCLI().run('rollback'))"
```

### Backups

Automated backup script (`/etc/cron.d/traversion-backup`):

```bash
0 2 * * * traversion /opt/traversion/scripts/backup.sh
```

Manual backup:

```bash
# Backup database
docker-compose -f docker-compose.production.yml exec postgres \
  pg_dump -U $POSTGRES_USER traversion_production > backup_$(date +%Y%m%d).sql

# Backup application data
tar -czf traversion_data_$(date +%Y%m%d).tar.gz /var/lib/traversion
```

## Scaling

### Horizontal Scaling

Deploy multiple instances with load balancer:

```nginx
upstream traversion_backend {
    least_conn;
    server traversion1.internal:3335;
    server traversion2.internal:3335;
    server traversion3.internal:3335;
}

server {
    listen 443 ssl http2;
    server_name traversion.yourdomain.com;

    location / {
        proxy_pass http://traversion_backend;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://traversion_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Database Scaling

For high load, use read replicas:

```javascript
// Configure in .env.production
POSTGRES_READ_REPLICAS=replica1.db.internal,replica2.db.internal
```

## Security Hardening

### SSL/TLS Configuration

```nginx
# Strong SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
ssl_stapling on;
ssl_stapling_verify on;
```

### Security Headers

```nginx
# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Content-Security-Policy "default-src 'self'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### Firewall Rules

```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed
```bash
# Check PostgreSQL status
docker-compose -f docker-compose.production.yml logs postgres

# Test connection
docker-compose -f docker-compose.production.yml exec postgres \
  psql -U $POSTGRES_USER -d traversion_production -c "SELECT 1"
```

#### 2. High Memory Usage
```bash
# Check memory usage
docker stats

# Restart with memory limits
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml up -d
```

#### 3. Deployment Failures
```bash
# Check deployment logs
tail -f /var/log/traversion/deployment_*.log

# Manual rollback
./scripts/deploy.sh rollback
```

### Debug Mode

Enable debug logging:

```bash
# Set in .env.production.local
LOG_LEVEL=debug
DEBUG_MODE=true
VERBOSE_ERRORS=true

# Restart services
docker-compose -f docker-compose.production.yml restart
```

## Maintenance

### Regular Tasks

- **Daily**: Check health endpoints, review error logs
- **Weekly**: Review metrics, update dependencies
- **Monthly**: Database optimization, security updates
- **Quarterly**: Performance review, capacity planning

### Update Procedure

```bash
# 1. Pull latest changes
git pull origin main

# 2. Review changes
git log --oneline HEAD..origin/main

# 3. Run deployment
./scripts/deploy.sh

# 4. Verify
curl http://localhost:3335/api/health/detailed
```

## Support

### Monitoring Alerts

Configure alerts for:
- Service down (health check failures)
- High error rate (>1%)
- Slow response time (>1s)
- Low disk space (<10%)
- High memory usage (>90%)

### Incident Response

1. Check health status: `/api/health/detailed`
2. Review recent deployments in tracker
3. Check error logs: `docker-compose logs traversion`
4. Use Traversion itself to analyze the incident
5. Generate rollback if needed

### Contact

- **Documentation**: https://docs.traversion.dev
- **Issues**: https://github.com/your-org/traversion/issues
- **Security**: security@traversion.dev

## License

See [LICENSE](LICENSE) file for details.