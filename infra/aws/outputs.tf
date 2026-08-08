output "alb_dns_name" {
  description = "Load balancer hostname. Smoke-test against this before shifting any DNS weight."
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
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

output "run_migrations_command" {
  description = "Migrations must run from inside the VPC; RDS is not publicly reachable."
  value       = <<-EOT
    aws ecs execute-command \
      --cluster ${aws_ecs_cluster.main.name} \
      --task "$(aws ecs list-tasks --cluster ${aws_ecs_cluster.main.name} --service-name identity --query 'taskArns[0]' --output text)" \
      --container identity --interactive \
      --command "node -e \"require('child_process').execSync('npx ts-node src/migrations/run.ts',{stdio:'inherit'})\""
  EOT
}
