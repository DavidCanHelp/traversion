#!/bin/bash

# Traversion Monitoring Setup Script
# Configures Prometheus, Grafana, and alerting for production deployment

set -e

# Configuration
GRAFANA_URL=${GRAFANA_URL:-http://localhost:3000}
GRAFANA_USER=${GRAFANA_USER:-admin}
GRAFANA_PASS=${GRAFANA_PASS:-admin}
PROMETHEUS_URL=${PROMETHEUS_URL:-http://localhost:9090}

echo "🚀 Setting up Traversion monitoring stack..."

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for $name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            echo "✅ $name is ready!"
            return 0
        fi
        
        echo "   Attempt $attempt/$max_attempts failed, retrying in 10 seconds..."
        sleep 10
        attempt=$((attempt + 1))
    done
    
    echo "❌ $name failed to start after $max_attempts attempts"
    return 1
}

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed"
    exit 1
fi

# Start monitoring services
echo "🐳 Starting monitoring services..."
docker-compose up -d prometheus grafana

# Wait for services to be ready
wait_for_service "$PROMETHEUS_URL/-/ready" "Prometheus"
wait_for_service "$GRAFANA_URL/api/health" "Grafana"

# Configure Grafana datasources
echo "📊 Configuring Grafana datasources..."

# Add Prometheus datasource
curl -X POST \
  "$GRAFANA_URL/api/datasources" \
  -u "$GRAFANA_USER:$GRAFANA_PASS" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Prometheus",
    "type": "prometheus",
    "url": "http://prometheus:9090",
    "access": "proxy",
    "isDefault": true
  }' >/dev/null || echo "   Datasource may already exist"

# Import dashboards
echo "📈 Importing Grafana dashboards..."

dashboard_files=(
    "monitoring/grafana/dashboards/traversion-overview.json"
    "monitoring/grafana/dashboards/traversion-causality.json"
    "monitoring/grafana/dashboards/traversion-security.json"
)

for dashboard_file in "${dashboard_files[@]}"; do
    if [ -f "$dashboard_file" ]; then
        dashboard_name=$(basename "$dashboard_file" .json)
        echo "   Importing $dashboard_name..."
        
        # Wrap dashboard JSON in the required format
        temp_file=$(mktemp)
        echo '{"dashboard":' > "$temp_file"
        cat "$dashboard_file" | jq '.dashboard' >> "$temp_file"
        echo ',"overwrite":true,"inputs":[{"name":"DS_PROMETHEUS","type":"datasource","pluginId":"prometheus","value":"Prometheus"}]}' >> "$temp_file"
        
        curl -X POST \
          "$GRAFANA_URL/api/dashboards/import" \
          -u "$GRAFANA_USER:$GRAFANA_PASS" \
          -H "Content-Type: application/json" \
          -d @"$temp_file" >/dev/null && echo "   ✅ Imported $dashboard_name" || echo "   ⚠️  $dashboard_name may already exist"
        
        rm "$temp_file"
    else
        echo "   ⚠️  Dashboard file not found: $dashboard_file"
    fi
done

# Verify Prometheus targets
echo "🎯 Checking Prometheus targets..."
targets_response=$(curl -s "$PROMETHEUS_URL/api/v1/targets")

if echo "$targets_response" | jq -e '.data.activeTargets[] | select(.health == "up")' >/dev/null; then
    healthy_targets=$(echo "$targets_response" | jq -r '.data.activeTargets[] | select(.health == "up") | .labels.job' | wc -l)
    echo "   ✅ $healthy_targets targets are healthy"
else
    echo "   ⚠️  No healthy targets found - services may still be starting"
fi

# Test alerting rules
echo "🚨 Validating alert rules..."
if curl -s "$PROMETHEUS_URL/api/v1/rules" | jq -e '.data.groups[].rules[] | select(.type == "alerting")' >/dev/null; then
    alert_count=$(curl -s "$PROMETHEUS_URL/api/v1/rules" | jq '.data.groups[].rules[] | select(.type == "alerting")' | wc -l)
    echo "   ✅ $alert_count alert rules loaded"
else
    echo "   ⚠️  No alert rules found"
fi

# Create monitoring health check script
echo "🏥 Creating monitoring health check script..."
cat > scripts/check-monitoring.sh << 'EOF'
#!/bin/bash

# Monitoring Health Check Script
echo "🔍 Checking Traversion monitoring health..."

# Check Prometheus
if curl -sf http://localhost:9090/-/ready >/dev/null; then
    echo "✅ Prometheus is healthy"
else
    echo "❌ Prometheus is unhealthy"
    exit 1
fi

# Check Grafana
if curl -sf http://localhost:3000/api/health >/dev/null; then
    echo "✅ Grafana is healthy"
else
    echo "❌ Grafana is unhealthy"
    exit 1
fi

# Check Traversion API metrics endpoint
if curl -sf http://localhost:3338/metrics >/dev/null; then
    echo "✅ Traversion API metrics are available"
else
    echo "❌ Traversion API metrics are unavailable"
    exit 1
fi

echo "🎉 All monitoring services are healthy!"
EOF

chmod +x scripts/check-monitoring.sh

# Display access information
echo ""
echo "🎉 Traversion monitoring setup complete!"
echo ""
echo "📊 Access Points:"
echo "   Grafana:    $GRAFANA_URL (admin/admin)"
echo "   Prometheus: $PROMETHEUS_URL"
echo "   API Metrics: http://localhost:3338/metrics"
echo ""
echo "📈 Available Dashboards:"
echo "   • Traversion Production Overview"
echo "   • Traversion Causality Intelligence" 
echo "   • Traversion Security & Authentication"
echo ""
echo "🚨 Alert Channels Configured:"
if [ -n "$SLACK_WEBHOOK" ]; then
    echo "   ✅ Slack notifications"
else
    echo "   ⚠️  Slack notifications (configure SLACK_WEBHOOK)"
fi

if [ -n "$SMTP_HOST" ]; then
    echo "   ✅ Email notifications"
else
    echo "   ⚠️  Email notifications (configure SMTP settings)"
fi

if [ -n "$PAGERDUTY_KEY" ]; then
    echo "   ✅ PagerDuty notifications"
else
    echo "   ⚠️  PagerDuty notifications (configure PAGERDUTY_KEY)"
fi

echo ""
echo "🔧 Next Steps:"
echo "   1. Change default Grafana password: $GRAFANA_URL/profile/password"
echo "   2. Configure alert channels in .env file"
echo "   3. Test alerts: ./scripts/check-monitoring.sh"
echo "   4. Review dashboards and customize for your needs"
echo ""
echo "📚 Documentation: README-MONITORING.md"
echo "🆘 Health Check: ./scripts/check-monitoring.sh"