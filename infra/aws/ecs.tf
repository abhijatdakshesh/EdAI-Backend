# ECR repositories, IAM roles, and the two Fargate services.
#
# Fargate rather than the EKS scaffold in infra/terraform: this stack runs two
# containers, not thirteen. EKS costs ~$75/month for the control plane alone and
# buys nothing until the microservice split in infra/k8s actually happens. That
# scaffold is left untouched for whenever it does.

resource "aws_ecr_repository" "identity" {
  name                 = "edai/identity"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "edai/web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "identity" {
  repository = aws_ecr_repository.identity.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}

locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images; rollback targets stay available"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

# ── IAM ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role pulls secrets at task start; the task role is what the
# application itself uses at runtime. Keeping them separate means application
# code cannot read the whole secret bundle.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "MediaBucket"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid       = "MediaBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }

  # Lets `aws ecs execute-command` open a shell in a running task, which is the
  # only practical way to run migrations against the private RDS instance.
  statement {
    sid = "ExecuteCommand"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "runtime"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ── Cluster and logs ────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "identity" {
  name              = "/ecs/${local.name}/identity"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = var.log_retention_days
}

# ── Task definitions ────────────────────────────────────────────────────────

locals {
  # Every value here is a Secrets Manager reference, never a literal. Plaintext
  # env vars are visible in the console and in `describe-task-definition`.
  app_secrets = [
    for k in [
      "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "AUTH_SECRET",
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
      "SARVAM_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY",
      "SUPPORT_AGENT_PHONE",
    ] : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }
  ]
}

resource "aws_ecs_task_definition" "identity" {
  family                   = "${local.name}-identity"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.identity_cpu
  memory                   = var.identity_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "identity"
    image     = "${aws_ecr_repository.identity.repository_url}:${var.identity_image_tag}"
    essential = true

    portMappings = [{ containerPort = 3001, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "INSTITUTION_ID", value = "rvce" },
      { name = "STRICT_DB", value = var.strict_db },
      # Fargate task count is fixed, so a modest per-task pool is safe. The
      # default of 20 per task is sized for a world with far fewer instances.
      { name = "DB_POOL_MAX", value = "10" },
      { name = "TWILIO_WEBHOOK_BASE_URL", value = "https://${local.api_fqdn}" },
      { name = "MEDIA_BUCKET", value = aws_s3_bucket.media.id },
      { name = "AWS_REGION", value = var.region },
    ]

    secrets = local.app_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.identity.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "identity"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3001/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.web.repository_url}:${var.web_image_tag}"
    essential = true

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "NEXTAUTH_URL", value = "https://${local.web_fqdn}" },
      # Server-side calls stay inside the VPC via the ALB's internal name.
      { name = "IDENTITY_SERVICE_URL", value = "https://${local.api_fqdn}" },
      { name = "NEXT_PUBLIC_USE_MOCKS", value = "false" },
    ]

    # Only AUTH_SECRET is needed at runtime; NEXT_PUBLIC_* values are baked in
    # at build time by the Dockerfile's ARGs and cannot be injected here.
    secrets = [
      { name = "AUTH_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:AUTH_SECRET::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

# ── Services ────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "identity" {
  name            = "identity"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.identity.arn
  desired_count   = var.identity_desired_count
  launch_type     = "FARGATE"

  enable_execute_command = true

  network_configuration {
    # With no NAT Gateway, tasks must sit in the public subnets and carry a
    # public IP to reach ECR, Twilio, Gemini and Sarvam. Ingress is still
    # restricted to the ALB security group.
    subnets          = local.task_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.identity.arn
    container_name   = "identity"
    container_port   = 3001
  }

  health_check_grace_period_seconds = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # At desired_count = 1 the in-memory state cannot survive an overlap, so the
  # old task must stop before the new one starts. Raise both once Phase 0 is
  # done and the service is genuinely stateless.
  deployment_minimum_healthy_percent = var.identity_desired_count > 1 ? 100 : 0
  deployment_maximum_percent         = var.identity_desired_count > 1 ? 200 : 100

  depends_on = [aws_lb_listener.https]

  lifecycle {
    # CI updates the image; Terraform should not revert it on the next apply.
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  enable_execute_command = true

  network_configuration {
    # With no NAT Gateway, tasks must sit in the public subnets and carry a
    # public IP to reach ECR, Twilio, Gemini and Sarvam. Ingress is still
    # restricted to the ALB security group.
    subnets          = local.task_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# The web tier is stateless, so it can scale on CPU. The identity service
# deliberately has no autoscaling until Phase 0 lands.
resource "aws_appautoscaling_target" "web" {
  max_capacity       = 6
  min_capacity       = var.web_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${local.name}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
