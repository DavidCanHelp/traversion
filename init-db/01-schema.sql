-- Traversion Production Database Schema
-- TimescaleDB for time-series event storage

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- For compound indexes

-- Create schema
CREATE SCHEMA IF NOT EXISTS traversion;
SET search_path TO traversion, public;

-- Tenants table (for multi-tenancy) - must be first
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE,
    settings JSONB DEFAULT '{}',
    storage_limit_gb INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Services table
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id VARCHAR(255) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    environment VARCHAR(50) DEFAULT 'production',
    hostname VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, service_id)
);

-- Events table (main time-series data)
CREATE TABLE IF NOT EXISTS events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    service_id UUID REFERENCES services(id),
    service_name VARCHAR(255),
    event_type VARCHAR(100) NOT NULL,
    trace_id UUID,
    span_id UUID,
    parent_span_id UUID,
    user_id UUID,
    data JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    anomaly_score DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert events table to TimescaleDB hypertable
SELECT create_hypertable('events', 'timestamp', 
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Causality relationships table
CREATE TABLE IF NOT EXISTS causality (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cause_event_id UUID REFERENCES events(event_id),
    effect_event_id UUID REFERENCES events(event_id),
    confidence DECIMAL(3,2) NOT NULL,
    causality_type VARCHAR(50), -- 'trace', 'temporal', 'dataflow', 'service'
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    UNIQUE(cause_event_id, effect_event_id)
);

-- Patterns table
CREATE TABLE IF NOT EXISTS patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_hash VARCHAR(64) UNIQUE NOT NULL,
    pattern_type VARCHAR(50),
    signature JSONB NOT NULL,
    occurrences INTEGER DEFAULT 1,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- System metrics table
CREATE TABLE IF NOT EXISTS metrics (
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL,
    tags JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert metrics to hypertable
SELECT create_hypertable('metrics', 'timestamp',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Sessions table (for tracking debugging sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_name VARCHAR(255),
    user_id VARCHAR(255),
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    queries_executed INTEGER DEFAULT 0,
    events_analyzed INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

-- Query cache table
CREATE TABLE IF NOT EXISTS query_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_hash VARCHAR(64) UNIQUE NOT NULL,
    query_text TEXT NOT NULL,
    result JSONB,
    execution_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    hit_count INTEGER DEFAULT 0
);

-- Users table (authentication)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer', -- 'admin', 'editor', 'viewer'
    permissions TEXT[] DEFAULT '{}',
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table (JWT session tracking)
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys table (for service-to-service authentication)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    prefix VARCHAR(20) NOT NULL,
    permissions TEXT[] DEFAULT '{}',
    last_used TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log table (track all authenticated actions)
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error', 'critical'
    service_id UUID REFERENCES services(id),
    event_id UUID REFERENCES events(event_id),
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX idx_events_timestamp ON events USING BRIN (timestamp);
CREATE INDEX idx_events_tenant_timestamp ON events (tenant_id, timestamp DESC);
CREATE INDEX idx_events_service_id ON events (service_id);
CREATE INDEX idx_events_event_type ON events (tenant_id, event_type);
CREATE INDEX idx_events_trace_id ON events (tenant_id, trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_events_span_id ON events (tenant_id, span_id) WHERE span_id IS NOT NULL;
CREATE INDEX idx_events_anomaly ON events (tenant_id, anomaly_score) WHERE anomaly_score > 0.5;
CREATE INDEX idx_events_tags ON events USING GIN (tags);
CREATE INDEX idx_events_data ON events USING GIN (data);
CREATE INDEX idx_events_user ON events (tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX idx_causality_cause ON causality (cause_event_id);
CREATE INDEX idx_causality_effect ON causality (effect_event_id);
CREATE INDEX idx_causality_confidence ON causality (confidence);

CREATE INDEX idx_metrics_tenant ON metrics (tenant_id, timestamp DESC);
CREATE INDEX idx_metrics_service ON metrics (tenant_id, service_id, timestamp DESC);
CREATE INDEX idx_metrics_name ON metrics (tenant_id, metric_name, timestamp DESC);

CREATE INDEX idx_alerts_service ON alerts (service_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_severity ON alerts (severity) WHERE resolved_at IS NULL;

-- Create compression policy for older data
SELECT add_compression_policy('events', INTERVAL '7 days');
SELECT add_compression_policy('metrics', INTERVAL '3 days');

-- Create data retention policies
SELECT add_retention_policy('events', INTERVAL '90 days');
SELECT add_retention_policy('metrics', INTERVAL '30 days');

-- Create continuous aggregates for common queries
CREATE MATERIALIZED VIEW events_per_minute
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 minute', timestamp) AS minute,
    tenant_id,
    service_id,
    event_type,
    COUNT(*) as event_count,
    AVG(anomaly_score) as avg_anomaly_score
FROM events
GROUP BY minute, tenant_id, service_id, event_type
WITH NO DATA;

-- Refresh policy for continuous aggregate
SELECT add_continuous_aggregate_policy('events_per_minute',
    start_offset => INTERVAL '10 minutes',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- Create functions for common operations
CREATE OR REPLACE FUNCTION get_system_state_at(target_time TIMESTAMP WITH TIME ZONE)
RETURNS TABLE(
    service_id UUID,
    service_name VARCHAR,
    event_count BIGINT,
    error_count BIGINT,
    avg_anomaly_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.service_id,
        e.service_name,
        COUNT(*) as event_count,
        COUNT(*) FILTER (WHERE e.event_type = 'error') as error_count,
        AVG(e.anomaly_score) as avg_anomaly_score
    FROM events e
    WHERE e.timestamp <= target_time
        AND e.timestamp > target_time - INTERVAL '5 minutes'
    GROUP BY e.service_id, e.service_name;
END;
$$ LANGUAGE plpgsql;

-- Function to find root cause
CREATE OR REPLACE FUNCTION find_root_cause(error_event_id UUID)
RETURNS TABLE(
    event_id UUID,
    event_type VARCHAR,
    service_name VARCHAR,
    timestamp TIMESTAMP WITH TIME ZONE,
    depth INTEGER,
    confidence DECIMAL
) AS $$
WITH RECURSIVE causality_chain AS (
    -- Base case: start with the error event
    SELECT 
        e.event_id,
        e.event_type,
        e.service_name,
        e.timestamp,
        0 as depth,
        1.0::DECIMAL as confidence
    FROM events e
    WHERE e.event_id = error_event_id
    
    UNION ALL
    
    -- Recursive case: follow causality backwards
    SELECT 
        e.event_id,
        e.event_type,
        e.service_name,
        e.timestamp,
        cc.depth + 1,
        cc.confidence * c.confidence
    FROM causality_chain cc
    JOIN causality c ON c.effect_event_id = cc.event_id
    JOIN events e ON e.event_id = c.cause_event_id
    WHERE cc.depth < 50 -- Prevent infinite recursion
)
SELECT * FROM causality_chain
ORDER BY depth DESC, confidence DESC;
$$ LANGUAGE plpgsql;

-- Authentication table indexes
CREATE INDEX idx_users_tenant ON users (tenant_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_active ON users (tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_sessions_user ON user_sessions (user_id);
CREATE INDEX idx_sessions_token ON user_sessions (session_token);
CREATE INDEX idx_sessions_expires ON user_sessions (expires_at) WHERE is_active = true;
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id) WHERE is_active = true;
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash) WHERE is_active = true;
CREATE INDEX idx_audit_tenant ON audit_log (tenant_id, timestamp DESC);
CREATE INDEX idx_audit_user ON audit_log (user_id, timestamp DESC);

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA traversion TO traversion;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA traversion TO traversion;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA traversion TO traversion;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA traversion TO traversion;