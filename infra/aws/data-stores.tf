# RDS PostgreSQL, ElastiCache Redis, and the secrets the tasks read at runtime.

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "db" {
  length  = 32
  special = false # avoids URL-encoding hazards in DATABASE_URL
}

# pgvector ships with RDS PostgreSQL 16 but is not enabled by default. After the
# first apply, run:  CREATE EXTENSION IF NOT EXISTS vector;
# The chatbot and nl-query modules expect it (docker-compose uses pgvector/pgvector:pg16).
resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 4
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "edai"
  username = "edai"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.data.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period = 7
  backup_window           = "18:00-19:00" # ~23:30 IST, off-peak for a college
  maintenance_window      = "sun:19:30-sun:20:30"

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-postgres-final"

  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql"]

  # DPDP Act 2023: student PII must not leave ap-south-1. Do not add a
  # cross-region replica without a compliance review.
  tags = { Name = "${local.name}-postgres" }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

# Redis backs the Phase 0 state moves: voice conversation state, parent OTPs,
# pending payment orders, the consent cache, and the Socket.IO adapter that lets
# EventsGateway broadcasts reach clients attached to a different task.
resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name}-redis"
  description          = "EdAI session, voice, and Socket.IO adapter state"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  num_cache_clusters         = var.db_multi_az ? 2 : 1
  automatic_failover_enabled = var.db_multi_az

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.data.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  # Voice conversation state is TTL-bounded and reconstructible; evicting the
  # oldest volatile keys under pressure beats refusing writes mid-call.
  parameter_group_name = "default.redis7"

  snapshot_retention_limit = 3
  snapshot_window          = "17:00-18:00"

  tags = { Name = "${local.name}-redis" }
}

# ── Secrets ─────────────────────────────────────────────────────────────────

locals {
  # Connection strings are derived, never hand-entered, so they cannot drift
  # from the instances above.
  database_url = "postgresql://edai:${random_password.db.result}@${aws_db_instance.main.endpoint}/edai?sslmode=require"
  redis_url    = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name}/app"
  description = "Runtime secrets for the EdAI web and identity tasks"

  # A short window so a mistaken destroy can be undone, without blocking a
  # same-name re-apply for the default 30 days.
  recovery_window_in_days = 7
}

# Values that Terraform knows. Everything else — JWT_SECRET, AUTH_SECRET,
# TWILIO_*, SARVAM_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY,
# SUPPORT_AGENT_PHONE — must be filled in by hand after the first apply, and is
# NOT managed here on purpose: putting them in tfvars would commit them to state
# in plaintext and, sooner or later, to git.
#
# AUTH_SECRET in particular must be copied verbatim from the existing Vercel
# project. A new value invalidates every active session at cutover.
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    DATABASE_URL = local.database_url
    REDIS_URL    = local.redis_url

    JWT_SECRET          = "REPLACE_ME"
    AUTH_SECRET         = "REPLACE_ME_COPY_FROM_VERCEL"
    TWILIO_ACCOUNT_SID  = "REPLACE_ME"
    TWILIO_AUTH_TOKEN   = "REPLACE_ME"
    TWILIO_PHONE_NUMBER = "REPLACE_ME"
    SARVAM_API_KEY      = "REPLACE_ME"
    GEMINI_API_KEY      = "REPLACE_ME"
    ANTHROPIC_API_KEY   = "REPLACE_ME"
    SUPPORT_AGENT_PHONE = "REPLACE_ME"
  })

  # Terraform writes the placeholders once. After they are replaced by hand (or
  # by CI), it must never overwrite them again.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# S3 for call recordings, generated PDFs, and TTS audio. Moving the in-memory
# audioStore here (rather than Redis) lets Twilio fetch audio directly by
# presigned URL and removes it from task memory entirely.
resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-tts-audio"
    status = "Enabled"

    filter {
      prefix = "tts/"
    }

    expiration {
      days = 7
    }
  }
}

data "aws_caller_identity" "current" {}
