# Certificates, optional CloudFront, and DNS.
#
# raycraft.in is hosted at GoDaddy (ns37/ns38.domaincontrol.com), and this AWS
# account cannot use Route 53 at all — ListHostedZones returns OptInRequired on
# the Free Plan. So `manage_dns` defaults to false and Terraform emits the
# records to enter by hand instead of creating them.
#
# The cost of that is weighted cutover. Route 53 can send 10% of traffic to AWS
# and step it up; GoDaddy cannot. The switch is all-or-nothing per hostname, and
# rollback means editing the record back — bounded by TTL, so keep the TTL low
# (600s) before switching.

data "aws_route53_zone" "main" {
  count = var.manage_dns ? 1 : 0

  name         = "${var.root_domain}."
  private_zone = false
}

# ── Certificates ────────────────────────────────────────────────────────────
# The ALB needs one in its own region. CloudFront only ever accepts one from
# us-east-1, so that second certificate exists only when CloudFront does.

resource "aws_acm_certificate" "regional" {
  domain_name               = local.api_fqdn
  subject_alternative_names = [local.web_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "cloudfront" {
  count    = var.enable_cloudfront ? 1 : 0
  provider = aws.us_east_1

  domain_name       = local.web_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # Both certificates validate the same hostnames, so their challenge records
  # collide. Deduplicated by record name.
  acm_validation_options = concat(
    tolist(aws_acm_certificate.regional.domain_validation_options),
    var.enable_cloudfront ? tolist(aws_acm_certificate.cloudfront[0].domain_validation_options) : [],
  )

  acm_validation_records = {
    for o in local.acm_validation_options :
    o.resource_record_name => {
      type   = o.resource_record_type
      record = o.resource_record_value
    }...
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = var.manage_dns ? local.acm_validation_records : {}

  zone_id         = data.aws_route53_zone.main[0].zone_id
  name            = each.key
  type            = each.value[0].type
  records         = [each.value[0].record]
  ttl             = 60
  allow_overwrite = true
}

# With manage_dns = false, validation_record_fqdns is omitted and this simply
# waits (45 min default) for the records to appear from wherever they are added.
# Apply the certificate on its own first, add the records at GoDaddy, then apply
# the rest — see README step 3.
resource "aws_acm_certificate_validation" "regional" {
  certificate_arn = aws_acm_certificate.regional.arn

  validation_record_fqdns = var.manage_dns ? [for r in aws_route53_record.acm_validation : r.fqdn] : null
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count    = var.enable_cloudfront ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.cloudfront[0].arn

  validation_record_fqdns = var.manage_dns ? [for r in aws_route53_record.acm_validation : r.fqdn] : null
}

# ── CloudFront (web tier, optional) ─────────────────────────────────────────

resource "aws_cloudfront_distribution" "web" {
  count = var.enable_cloudfront ? 1 : 0

  enabled         = true
  is_ipv6_enabled = true
  aliases         = [local.web_fqdn]
  price_class     = "PriceClass_200" # includes India; excludes South America / Oceania
  comment         = "${local.name} web"

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  # Default: dynamic, personalised, never cached. Next.js sets its own
  # Cache-Control per route; CloudFront must not second-guess it.
  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # Build assets are content-hashed and safe to cache hard.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = data.aws_cloudfront_cache_policy.optimized.id
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# ── Records (only when Route 53 is available) ───────────────────────────────

resource "aws_route53_record" "api" {
  count = var.manage_dns ? 1 : 0

  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = local.api_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

variable "aws_traffic_weight" {
  type        = number
  description = <<-EOT
    Share of app.<domain> traffic sent to AWS, 0-100. Route 53 only — GoDaddy
    cannot split traffic, so with manage_dns = false this has no effect and the
    cutover is a single record edit.
  EOT
  default     = 0
}

resource "aws_route53_record" "web_aws" {
  count = var.manage_dns ? 1 : 0

  zone_id        = data.aws_route53_zone.main[0].zone_id
  name           = local.web_fqdn
  type           = "A"
  set_identifier = "aws"

  weighted_routing_policy {
    weight = var.aws_traffic_weight
  }

  alias {
    name                   = var.enable_cloudfront ? aws_cloudfront_distribution.web[0].domain_name : aws_lb.main.dns_name
    zone_id                = var.enable_cloudfront ? aws_cloudfront_distribution.web[0].hosted_zone_id : aws_lb.main.zone_id
    evaluate_target_health = false
  }
}
