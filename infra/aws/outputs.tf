output "alb_dns_name" {
  description = "Load balancer hostname. Smoke-test against this before touching any DNS."
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  value = var.enable_cloudfront ? aws_cloudfront_distribution.web[0].domain_name : null
}

output "ecr_identity_repository_url" {
  value = aws_ecr_repository.identity.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "media_bucket" {
  value = aws_s3_bucket.media.id
}

output "app_secret_arn" {
  description = "Fill the REPLACE_ME entries here before the first deploy."
  value       = aws_secretsmanager_secret.app.arn
}

output "database_url" {
  description = "Composed connection string. Also written into Secrets Manager."
  value       = local.database_url
  sensitive   = true
}

# ── Manual DNS, for zones Terraform does not manage ─────────────────────────

output "acm_validation_records" {
  description = <<-EOT
    CNAME records to create at the DNS host (GoDaddy for raycraft.in) so ACM can
    validate the certificate. GoDaddy appends the domain automatically, so enter
    only the part of the name BEFORE .raycraft.in, and drop the trailing dot
    from the value.
  EOT
  value = {
    for name, opts in local.acm_validation_records :
    name => opts[0].record
  }
}

output "cutover_records" {
  description = <<-EOT
    The records to change at GoDaddy once the smoke tests pass. Set TTL to 600
    BEFORE cutting over, so a rollback takes ten minutes rather than an hour.

    Rollback for app: restore the A record to 76.76.21.21 (Vercel).
  EOT
  value = {
    "api (CNAME)" = aws_lb.main.dns_name
    "app (CNAME)" = var.enable_cloudfront ? aws_cloudfront_distribution.web[0].domain_name : aws_lb.main.dns_name
  }
}

output "run_migrations_command" {
  description = "Migrations run from inside a task; RDS is not publicly reachable."
  value       = <<-EOT
    aws ecs execute-command \
      --cluster ${aws_ecs_cluster.main.name} \
      --task "$(aws ecs list-tasks --cluster ${aws_ecs_cluster.main.name} --service-name identity --query 'taskArns[0]' --output text)" \
      --container identity --interactive \
      --command "/bin/sh"
  EOT
}
