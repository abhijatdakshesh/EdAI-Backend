# ACM certificates, CloudFront for the web tier, and weighted Route 53 records
# for a gradual cutover from Vercel.

data "aws_route53_zone" "main" {
  name         = "${var.root_domain}."
  private_zone = false
}

# ── Certificates ────────────────────────────────────────────────────────────
# Two are required: the ALB needs one in its own region, CloudFront only ever
# accepts one from us-east-1.

resource "aws_acm_certificate" "regional" {
  domain_name               = local.api_fqdn
  subject_alternative_names = [local.web_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "cloudfront" {
  provider = aws.us_east_1

  domain_name       = local.web_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Both certificates validate against the same hostnames, so their DNS challenge
# records collide. Deduplicated by record name; allow_overwrite lets whichever
# applies second reuse the record.
locals {
  acm_validation_options = concat(
    tolist(aws_acm_certificate.regional.domain_validation_options),
    tolist(aws_acm_certificate.cloudfront.domain_validation_options),
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
  for_each = local.acm_validation_records

  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.key
  type            = each.value[0].type
  records         = [each.value[0].record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "regional" {
  certificate_arn         = aws_acm_certificate.regional.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

# ── CloudFront (web tier) ───────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "web" {
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
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront.certificate_arn
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

# ── Records ─────────────────────────────────────────────────────────────────

# api.<domain> goes straight to the ALB; no CDN in front of an API.
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.api_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# app.<domain> is weighted so traffic can be shifted from Vercel in steps.
#
# Vercel's own record must be edited by hand to carry the complementary weight
# and the SAME set_identifier scheme; Terraform does not manage it. Cutover:
#   aws_weight 10  → watch → 50 → watch → 100
# Rolling back is the same command with a lower number, and takes effect in one
# TTL. Keep the Vercel deployment alive for 7 days after reaching 100.
variable "aws_traffic_weight" {
  type        = number
  description = "Share of app.<domain> traffic sent to AWS, 0-100. Start at 0."
  default     = 0
}

resource "aws_route53_record" "web_aws" {
  zone_id        = data.aws_route53_zone.main.zone_id
  name           = local.web_fqdn
  type           = "A"
  set_identifier = "aws"

  weighted_routing_policy {
    weight = var.aws_traffic_weight
  }

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
