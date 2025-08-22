# Traversion Kubernetes Deployment

This directory contains comprehensive Kubernetes manifests for deploying Traversion in a production environment with full observability, security, and scalability.

## Architecture Overview

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Load Balancer     │    │     Ingress         │    │   Cert Manager      │
│   (Cloud Provider)  │───▶│   (NGINX)           │    │   (Let's Encrypt)   │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
                                      │
                           ┌──────────┴──────────┐
                           │                     │
                    ┌─────────────┐      ┌─────────────┐
                    │ Traversion  │      │ Monitoring  │
                    │   API       │      │  Stack      │
                    │ (3-50 pods) │      └─────────────┘
                    └─────────────┘              │
                           │               ┌─────┴─────┐
                    ┌──────┴──────┐       │           │
                    │             │   ┌───────┐  ┌─────────┐
            ┌───────────┐  ┌─────────────┐│Prometh│  │ Grafana │
            │TimescaleDB│  │   Redis     ││eus    │  │         │
            │  (Primary)│  │  (Cache)    │└───────┘  └─────────┘
            └───────────┘  └─────────────┘
```

## Components

### Core Application
- **Traversion API**: Main application with auto-scaling (3-50 pods)
- **TimescaleDB**: Time-series database for events and metrics
- **Redis**: Session store and caching layer

### Monitoring & Observability
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization dashboards
- **Alert Rules**: Comprehensive alerting for system health

### Security & Networking
- **Network Policies**: Micro-segmentation for pod-to-pod communication
- **TLS Termination**: Automatic SSL certificates via Let's Encrypt
- **RBAC**: Role-based access control for service accounts
- **Security Context**: Non-root containers with read-only filesystems

### High Availability & Scaling
- **HPA**: Horizontal Pod Autoscaler based on CPU, memory, and custom metrics
- **PDB**: Pod Disruption Budget for rolling updates
- **Resource Limits**: CPU and memory quotas
- **Persistent Storage**: SSD-backed persistent volumes

## Prerequisites

1. **Kubernetes Cluster** (1.25+)
2. **Ingress Controller** (NGINX recommended)
3. **Cert Manager** for TLS certificates
4. **Metrics Server** for HPA
5. **Storage Class** with SSD support

## Deployment Instructions

### 1. Install Dependencies

```bash
# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml

# Install Cert Manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.1/cert-manager.yaml

# Install Metrics Server (if not present)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 2. Configure Secrets

Edit `secrets.yaml` and replace all `REPLACE_WITH_*` values:

```bash
# Generate secure passwords
openssl rand -base64 32  # For database passwords
openssl rand -hex 32     # For JWT secrets
```

Required secrets:
- Database credentials (TimescaleDB)
- Redis password
- JWT signing keys
- Cloud storage credentials (optional)
- SMTP credentials (optional)

### 3. Update Domain Names

Edit `ingress.yaml` and replace `company.com` with your domain:
- `api.traversion.company.com`
- `ws.traversion.company.com`
- `monitoring.traversion.company.com`
- `grafana.traversion.company.com`

### 4. Build and Push Docker Image

```bash
# Build the image
docker build -t traversion:latest .

# Tag for your registry
docker tag traversion:latest your-registry.com/traversion:latest

# Push to registry
docker push your-registry.com/traversion:latest

# Update image reference in traversion-app.yaml
```

### 5. Deploy to Kubernetes

```bash
# Apply all manifests
kubectl apply -f k8s/

# Or use Kustomize for better management
kubectl apply -k k8s/

# Verify deployment
kubectl get all -n traversion-system
```

### 6. Verify Deployment

```bash
# Check pod status
kubectl get pods -n traversion-system

# Check services
kubectl get svc -n traversion-system

# Check ingress
kubectl get ingress -n traversion-system

# View logs
kubectl logs -f deployment/traversion-app -n traversion-system

# Test API endpoint
curl -k https://api.traversion.company.com/api/health
```

## Environment-Specific Configurations

### Development/Staging

```bash
# Apply to staging namespace
kubectl apply -f k8s/ --namespace=traversion-staging

# Reduce resource requirements
# Edit patches/production-resources.yaml for lower limits
```

### Production Scaling

The configuration supports:
- **Auto-scaling**: 5-50 pods based on CPU, memory, and request rate
- **Database**: 200GB storage with regional replication
- **Monitoring**: 30-day retention with advanced alerting

## Monitoring & Alerting

### Access Dashboards

- **Grafana**: `https://grafana.traversion.company.com`
  - Username: `admin`
  - Password: `traversion123` (change in production)

- **Prometheus**: `https://monitoring.traversion.company.com`

### Key Metrics

- API request rate and response times
- Error rates and status codes
- WebSocket connection counts
- Database performance metrics
- Resource utilization (CPU, memory, storage)
- Causality analysis metrics

### Alert Rules

Critical alerts:
- API or database down (1 minute)
- High error rate (> 10% for 2 minutes)
- High response time (> 2s for 5 minutes)
- Resource exhaustion (CPU > 80%, Memory > 80%)

## Backup & Recovery

### Database Backups

Automated backups are configured via the application:
- **Daily**: Full backup at 2 AM
- **Hourly**: Incremental backups
- **Weekly**: Cloud storage backup
- **Monthly**: Archive backup

### Persistent Volume Backups

```bash
# Manual backup of persistent volumes
kubectl exec -n traversion-system statefulset/timescaledb -- pg_dump -U traversion traversion > backup.sql

# Restore from backup
kubectl exec -i -n traversion-system statefulset/timescaledb -- psql -U traversion traversion < backup.sql
```

## Security Considerations

### Network Policies
- Pod-to-pod communication is restricted
- Only necessary ports are allowed
- External traffic is controlled via ingress

### Container Security
- Non-root user execution
- Read-only root filesystem
- Minimal Alpine base image
- Security context constraints

### TLS Configuration
- End-to-end encryption
- Automatic certificate renewal
- Strong cipher suites
- HTTP to HTTPS redirection

## Troubleshooting

### Common Issues

1. **Pods not starting**
   ```bash
   kubectl describe pod <pod-name> -n traversion-system
   kubectl logs <pod-name> -n traversion-system
   ```

2. **Database connection errors**
   ```bash
   kubectl exec -it statefulset/timescaledb -n traversion-system -- psql -U traversion
   ```

3. **Ingress issues**
   ```bash
   kubectl describe ingress traversion-ingress -n traversion-system
   ```

4. **Certificate problems**
   ```bash
   kubectl describe certificaterequests -n traversion-system
   kubectl logs -n cert-manager deployment/cert-manager
   ```

### Performance Tuning

1. **Adjust HPA thresholds** in `hpa.yaml`
2. **Scale database resources** in `timescaledb.yaml`
3. **Tune application settings** in `configmap.yaml`
4. **Optimize persistent volume sizes** in `persistent-volumes.yaml`

## Maintenance

### Updates

```bash
# Update application image
kubectl set image deployment/traversion-app traversion=traversion:v1.2.0 -n traversion-system

# Rolling restart
kubectl rollout restart deployment/traversion-app -n traversion-system

# Monitor rollout
kubectl rollout status deployment/traversion-app -n traversion-system
```

### Cleanup

```bash
# Remove all resources
kubectl delete -f k8s/

# Or delete namespace (removes everything)
kubectl delete namespace traversion-system
```

## Cost Optimization

- Use **spot instances** for development environments
- Configure **vertical pod autoscaling** for optimal resource usage
- Set up **resource quotas** to prevent resource waste
- Use **node affinity** to optimize pod placement
- Enable **cluster autoscaling** for cost-effective scaling

## Support

For issues and questions:
- Check the application logs
- Review Kubernetes events
- Consult Grafana dashboards
- Contact the development team with specific error messages