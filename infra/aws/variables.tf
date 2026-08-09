variable "region" {
  type        = string
  description = "AWS region. ap-south-1 (Mumbai) is required for DPDP Act 2023 data residency."
  default     = "ap-south-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment: staging or prod."
  default     = "prod"
}

variable "root_domain" {
  type        = string
  description = "Route 53 hosted zone apex, e.g. raycraft.in. Must already exist."
  default     = "raycraft.in"
}

variable "web_subdomain" {
  type        = string
  description = "Hostname for the Next.js portal."
  default     = "app"
}

variable "api_subdomain" {
  type        = string
  description = "Hostname for the NestJS identity service."
  default     = "api"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "az_count" {
  type        = number
  description = "Availability zones to span. RDS Multi-AZ requires at least 2."
  default     = 2
}

variable "single_nat_gateway" {
  type        = bool
  description = <<-EOT
    One NAT Gateway for all private subnets instead of one per AZ.
    Saves ~$35/month and makes the NAT's AZ a single point of failure for
    outbound traffic. Acceptable for a pilot; set false before you depend on
    this for a full intake cycle.
  EOT
  default     = true
}

variable "enable_nat_gateway" {
  type        = bool
  description = <<-EOT
    When false, no NAT Gateway is created and ECS tasks run in the PUBLIC
    subnets with a public IP, which they need in order to pull images from ECR
    and reach Twilio, Gemini and Sarvam.

    This saves ~$35/month, and it is a real security trade: the tasks get a
    routable address. Their security group still accepts ingress only from the
    ALB, so nothing is reachable from the internet, but there is no longer a
    routing-level guarantee behind that.

    RDS and ElastiCache stay in the private subnets either way — the data layer
    is never publicly addressable regardless of this setting.
  EOT
  default     = true
}

variable "enable_cloudfront" {
  type        = bool
  description = <<-EOT
    CDN in front of the web tier. Off for the pilot: the ALB serves Next.js
    directly, which is correct but without edge caching of /_next/static.
    Turning it on later is additive and changes only the app hostname's DNS
    target.
  EOT
  default     = true
}

variable "manage_dns" {
  type        = bool
  description = <<-EOT
    Whether Terraform manages Route 53 records.

    FALSE for raycraft.in: the zone is hosted at GoDaddy (ns37/ns38.
    domaincontrol.com), and this AWS account cannot use Route 53 at all —
    ListHostedZones returns OptInRequired on the Free Plan. ACM validation
    records and the final cutover record are emitted as outputs for manual
    entry instead.

    The cost of this is weighted cutover: GoDaddy cannot split traffic, so the
    Vercel → AWS switch is all-or-nothing per hostname. Rollback is editing the
    record back, bounded by TTL rather than by a Route 53 weight change.
  EOT
  default     = false
}

# ── Compute sizing ──────────────────────────────────────────────────────────

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "identity_cpu" {
  type    = number
  default = 1024
}

variable "identity_memory" {
  type    = number
  default = 2048
}

variable "identity_desired_count" {
  type        = number
  description = <<-EOT
    Task count for the identity service.

    DO NOT raise this above 1 until Phase 0 state remediation is complete and
    verified. The service still keeps the user store, voice conversation state,
    TTS audio buffers, parent OTPs, pending payment orders and proctored exam
    attempts in process memory. With more than one task those states diverge
    per-task: user counts flicker, parent OTP verification fails roughly half
    the time, Twilio fetches call audio from a task that does not have it, and
    payment callbacks land on a task that has never heard of the order.

    The Azure pipeline pinned --min-replicas 1 --max-replicas 1 for exactly
    this reason. See AWS_MIGRATION_PHASE0.md.
  EOT
  default     = 1
}

# ── Data stores ─────────────────────────────────────────────────────────────

variable "db_instance_class" {
  type        = string
  description = "RDS instance class. The old EKS scaffold specified db.t3.xlarge (~$380/mo), which is oversized for a pilot."
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

# ── Application configuration ───────────────────────────────────────────────

variable "identity_image_tag" {
  type        = string
  description = "ECR image tag for the identity service. CI overrides this with the commit SHA."
  default     = "latest"
}

variable "web_image_tag" {
  type    = string
  default = "latest"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "strict_db" {
  type        = string
  description = <<-EOT
    Passed to the identity task as STRICT_DB. "1" makes DatabasePreflightService
    refuse to start when any registered entity lacks metadata or a table.
    Recommended in staging; in production a loud ERROR plus a degraded service
    usually beats a container that will not start.
  EOT
  default     = "0"
}

variable "db_deletion_protection" {
  type        = bool
  description = <<-EOT
    Blocks `terraform destroy` from removing the database, and takes a final
    snapshot. True for production. False for a credit-limited pilot that has to
    be tearable-down, which also means an accidental destroy loses the data.
  EOT
  default     = true
}
