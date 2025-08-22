# Traversion Production Deployment Guide

## 🚀 Quick Start with Docker

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- 8GB RAM minimum
- 20GB disk space

### 1. Clone and Configure
```bash
# Clone the repository
git clone https://github.com/davidcanhelp/traversion.git
cd traversion

# Copy environment configuration
cp .env.example .env

# Edit .env with your settings
nano .env
```

### 2. Start All Services
```bash
# Start with Docker Compose
docker-compose up -d

# Check service health
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Access Services
- **Production Dashboard**: http://localhost:3335
- **API**: http://localhost:3338
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090

## 📦 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Load Balancer                          │
└─────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Dashboard  │   │   Query API   │   │  Collector   │
│   (Nginx)    │   │   (Node.js)   │   │  (Node.js)   │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                ┌───────────┼───────────┐
                ▼                       ▼
        ┌──────────────┐       ┌──────────────┐
        │  TimescaleDB  │       │    Redis     │
        │  (Events)     │       │   (Cache)    │
        └──────────────┘       └──────────────┘
```

## 🗄️ Database Setup

### TimescaleDB Configuration
The database is automatically initialized with:
- Hypertables for time-series data
- Compression policies (7 days for events, 3 days for metrics)
- Retention policies (90 days for events, 30 days for metrics)
- Continuous aggregates for performance
- Optimized indexes for queries

### Manual Database Setup (Optional)
```bash
# Connect to database
docker exec -it traversion-timescale psql -U traversion

# Run initialization script
\i /docker-entrypoint-initdb.d/01-schema.sql

# Verify tables
\dt traversion.*
```

## 🔧 Service Configuration

### Environment Variables
Key configuration options in `.env`:

```bash
# Database
DB_HOST=timescaledb          # Docker service name
DB_PORT=5432
DB_NAME=traversion
DB_USER=traversion
DB_PASSWORD=your-secure-password

# Redis
REDIS_HOST=redis              # Docker service name
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# API
API_PORT=3338
WS_PORT=3339

# Performance
MAX_EVENTS_PER_BATCH=1000     # Batch size for inserts
BATCH_FLUSH_INTERVAL=1000     # Flush interval in ms
CACHE_TTL=300                  # Cache TTL in seconds

# Retention
DATA_RETENTION_DAYS=90        # How long to keep events
```

## 📊 Monitoring Setup

### Grafana Dashboards
1. Access Grafana at http://localhost:3000
2. Login with admin/admin (change password)
3. Import dashboards from `monitoring/grafana/dashboards/`

### Prometheus Metrics
Available metrics:
- `traversion_events_total` - Total events processed
- `traversion_causality_detections` - Causality relationships found
- `traversion_query_duration` - Query execution times
- `traversion_storage_size` - Database size

### Health Checks
```bash
# Check API health
curl http://localhost:3338/health

# Check statistics
curl http://localhost:3338/api/stats
```

## 🚢 Production Deployment

### Using Docker Swarm
```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml traversion

# Scale services
docker service scale traversion_collector=3
docker service scale traversion_api=2
```

### Using Kubernetes
```bash
# Apply configurations
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployments/
kubectl apply -f k8s/services/
kubectl apply -f k8s/ingress.yaml

# Check deployment
kubectl get pods -n traversion
kubectl get services -n traversion
```

## 🔒 Security Considerations

### SSL/TLS Setup
```nginx
# nginx.conf for dashboard
server {
    listen 443 ssl http2;
    server_name traversion.example.com;
    
    ssl_certificate /etc/ssl/certs/traversion.crt;
    ssl_certificate_key /etc/ssl/private/traversion.key;
    
    location / {
        proxy_pass http://dashboard:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### API Authentication
```javascript
// Example: Using API key
const response = await fetch('https://api.traversion.com/events', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(events)
});
```

### Network Security
- Use private networks for internal communication
- Expose only necessary ports
- Implement firewall rules
- Use VPN for remote access

## 📈 Performance Tuning

### TimescaleDB Optimization
```sql
-- Adjust chunk size based on data volume
SELECT set_chunk_time_interval('events', INTERVAL '2 hours');

-- Update compression policy
SELECT alter_job(job_id, schedule_interval => INTERVAL '1 hour')
FROM timescaledb_information.jobs
WHERE proc_name = 'policy_compression';

-- Analyze tables regularly
ANALYZE traversion.events;
ANALYZE traversion.causality;
```

### Redis Optimization
```redis
# Set max memory policy
CONFIG SET maxmemory 2gb
CONFIG SET maxmemory-policy allkeys-lru

# Enable persistence
CONFIG SET save "900 1 300 10 60 10000"
```

### Node.js Optimization
```bash
# Set Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096"

# Enable cluster mode for API
PM2_INSTANCES=4
```

## 🔄 Backup and Recovery

### Automated Backups
```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec traversion-timescale pg_dump -U traversion > backup_$DATE.sql
aws s3 cp backup_$DATE.sql s3://traversion-backups/
EOF

# Schedule with cron
0 2 * * * /path/to/backup.sh
```

### Manual Backup
```bash
# Backup database
docker exec traversion-timescale pg_dump -U traversion > backup.sql

# Backup Redis
docker exec traversion-redis redis-cli BGSAVE

# Copy Redis dump
docker cp traversion-redis:/data/dump.rdb redis_backup.rdb
```

### Recovery
```bash
# Restore database
docker exec -i traversion-timescale psql -U traversion < backup.sql

# Restore Redis
docker cp redis_backup.rdb traversion-redis:/data/dump.rdb
docker restart traversion-redis
```

## 🐛 Troubleshooting

### Common Issues

#### Services Won't Start
```bash
# Check logs
docker-compose logs service-name

# Check resource usage
docker stats

# Verify network
docker network ls
docker network inspect traversion_traversion-network
```

#### Database Connection Issues
```bash
# Test connection
docker exec traversion-api pg_isready -h timescaledb -U traversion

# Check credentials
docker exec traversion-api env | grep DB_
```

#### High Memory Usage
```bash
# Check memory usage
docker stats --no-stream

# Adjust memory limits in docker-compose.yml
services:
  api:
    mem_limit: 1g
    mem_reservation: 512m
```

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug docker-compose up

# Connect to container
docker exec -it traversion-api sh

# Run diagnostics
node -e "require('./src/api/server.js')"
```

## 📋 Maintenance

### Regular Tasks
- **Daily**: Check health endpoints, review error logs
- **Weekly**: Analyze query performance, update dashboards
- **Monthly**: Review retention policies, optimize indexes
- **Quarterly**: Update dependencies, security audit

### Scaling Checklist
- [ ] Monitor resource usage trends
- [ ] Plan capacity for data growth
- [ ] Test horizontal scaling
- [ ] Optimize slow queries
- [ ] Review caching strategy

## 🆘 Support

### Getting Help
- Documentation: `/docs` directory
- Issues: GitHub Issues
- Community: Discord/Slack channel

### Useful Commands
```bash
# View all container logs
docker-compose logs

# Restart specific service
docker-compose restart api

# Execute command in container
docker exec traversion-api node -e "console.log('test')"

# Database console
docker exec -it traversion-timescale psql -U traversion

# Redis console
docker exec -it traversion-redis redis-cli
```

## 🎉 Success Indicators

Your Traversion deployment is successful when:
- ✅ All containers are running (`docker-compose ps`)
- ✅ Health check returns "healthy" 
- ✅ Dashboard loads and shows real-time data
- ✅ TimeQL queries execute successfully
- ✅ Events are being stored in database
- ✅ Causality detection is working
- ✅ Metrics appear in Grafana

---

*For development setup, see [DEVELOPMENT.md](./docs/DEVELOPMENT.md)*
*For API documentation, see [API.md](./docs/API.md)*