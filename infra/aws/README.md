# EdAI on AWS — ECS Fargate stack (ap-south-1)

Replaces the Vercel projects `ed8ai` (Next.js portal → `app.raycraft.in`) and
`identity` (NestJS, one serverless function with a 30s cap).

**This stack has never been applied.** No AWS account was reachable from the
machine it was written on, so every resource below is unexercised. Treat the
first `apply` as the real test.

---

## Why ECS and not the EKS scaffold in `infra/terraform/`

That scaffold provisions EKS + RDS + ElastiCache, and `infra/k8s/base/` declares
thirteen microservices. Exactly one of them — `identity` — is deployed anywhere.
EKS costs ~$75/month for the control plane alone and carries real operational
weight; it buys nothing until the other twelve exist. This stack runs the two
containers that are actually shipping. `infra/terraform/` is left untouched for
whenever the split happens.

---

## Prerequisites

1. An AWS account with the `raycraft.in` **Route 53 hosted zone already
   present**. `dns.tf` looks it up with a data source and fails fast otherwise.
2. Terraform >= 1.6 and credentials with permission to create VPC, ECS, RDS,
   ElastiCache, ALB, CloudFront, ACM, ECR, S3, IAM and Route 53 resources.
3. The current Vercel `AUTH_SECRET`, copied verbatim. A different value
   invalidates every active session the moment traffic shifts.

---

## Order of operations

### 1. State backend (do this first)

Local state is fine for exactly one apply and a liability after that.

```bash
aws s3api create-bucket --bucket edai-tfstate-ap-south-1 \
  --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket edai-tfstate-ap-south-1 \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name edai-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region ap-south-1
```

Then uncomment the `backend "s3"` block in `versions.tf` and `terraform init -migrate-state`.

### 2. Apply the infrastructure

```bash
terraform init
terraform plan -out=tf.plan     # read it
terraform apply tf.plan
```

`aws_traffic_weight` defaults to `0`, so **no production traffic moves.**
`app.raycraft.in` keeps resolving to Vercel throughout.

Expect ~20 minutes; RDS and CloudFront dominate.

### 3. Fill in the secrets

Terraform writes `DATABASE_URL` and `REDIS_URL` (both derived from the resources
it created) and `REPLACE_ME` placeholders for everything else. The real values
are deliberately not in Terraform — anything in a variable ends up in state in
plaintext, and state ends up in git eventually.

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw app_secret_arn)" \
  --secret-string "$(aws secretsmanager get-secret-value \
      --secret-id "$(terraform output -raw app_secret_arn)" \
      --query SecretString --output text \
    | jq '.JWT_SECRET="…" | .AUTH_SECRET="…copy from Vercel…" | .TWILIO_AUTH_TOKEN="…"')"
```

### 4. Enable pgvector

`chatbot` and `nl-query` expect it (`docker-compose.yml` uses
`pgvector/pgvector:pg16`). RDS ships the extension but does not enable it.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 5. Build and push images

Both Dockerfiles already exist and need no changes. `apps/web` sets
`output: "standalone"` in `next.config.mjs`; make sure `NEXT_DISABLE_STANDALONE`
is **unset** in the build, or `server.js` is never emitted.

See `.github/workflows/deploy-aws.yml`, or push by hand once to bootstrap.

### 6. Run migrations

RDS is in private subnets and is not publicly reachable, so migrations run from
inside a task:

```bash
terraform output -raw run_migrations_command
```

Verify from the identity task's startup logs:

```
[DatabasePreflight] Persistence ready for 31/31 entities.
```

Anything less means a migration did not apply. `DatabasePreflightService` names
each gap explicitly.

### 7. Smoke-test before any DNS change

Hit the ALB directly with a `Host` header — no user traffic involved:

```bash
curl -H "Host: api.raycraft.in" https://$(terraform output -raw alb_dns_name)/api/health
```

Then run the full `GO_LIVE.md` suite against `api.raycraft.in`: login for all
four roles, OBE/CO-PO attainment, CO-PO mapping, integrity check, revision plan,
achievements, discussion forum, proctored exam, and a live Kannada admission
call with press-1/2 DTMF.

### 8. Re-point Twilio

`TWILIO_WEBHOOK_BASE_URL` is set on the task, but the webhook URLs configured in
the **Twilio console** are separate and must be changed by hand. Miss this and
voice fails silently — calls connect and then nothing happens.

### 9. Shift traffic

```bash
terraform apply -var aws_traffic_weight=10   # watch 30 min
terraform apply -var aws_traffic_weight=50   # watch 30 min
terraform apply -var aws_traffic_weight=100
```

Vercel's record must carry the complementary weight; Terraform does not manage
it. Watch ALB 5xx, target-group health, RDS connections and CloudWatch error
logs at each step. Rolling back is the same command with a lower number and
takes effect within one TTL.

**Keep the Vercel deployments live and undeleted for 7 days.**

---

## ⚠️ `identity_desired_count` must stay at 1

Until Phase 0 state remediation is done and verified, the identity service keeps
the user store, voice conversation state, TTS audio buffers, parent OTPs,
pending payment orders and proctored exam attempts in process memory. With two
tasks:

- `GET /api/users` counts flicker and PARENT validation can be skipped
- parent OTP verification fails roughly half the time
- Twilio fetches call audio from a task that does not have it — dead air
- payment gateway callbacks land on a task that never saw the order — **money
  taken, fees not credited**

The Azure pipeline pinned `--min-replicas 1 --max-replicas 1` for exactly this
reason. Migrating does not fix it. See `AWS_MIGRATION_PHASE0.md`.

The web tier has no such constraint and autoscales on CPU.

---

## Cost estimate (ap-south-1, monthly)

| Item | Est. |
|---|---|
| Fargate — 1 identity (1vCPU/2GB) + 2 web (0.5vCPU/1GB) | $55–70 |
| ALB (one, host-routed) | $18 |
| RDS `db.t4g.medium` Multi-AZ + 50GB gp3 | $110 |
| ElastiCache `cache.t4g.micro` ×2 | $26 |
| NAT Gateway (single) | $35 |
| CloudFront + S3 + Route 53 + Secrets Manager | $12–25 |
| **Total** | **≈ $256–284** |

Two deliberate cost/reliability trades, both one variable away from being fixed:
`single_nat_gateway = true` makes one AZ a single point of failure for outbound
traffic, and `db_instance_class` is a quarter of the size the old EKS scaffold
specified (`db.t3.xlarge`, ~$380/month by itself).

---

## What you lose by leaving Vercel

- **Per-PR preview deployments** — the biggest practical loss. Replacing them
  means an ECS-service-per-PR pipeline, or accepting one shared staging
  environment.
- **Zero-config image optimisation** — `next/image` falls back to in-container
  `sharp`, which costs task CPU.
- **Automatic rollbacks** — replaced by ECS task-definition revisions plus the
  deployment circuit breaker. Workable, less slick.

Worth it here because: request duration is no longer capped at 30s (voice and AI
calls need more), student PII stays in `ap-south-1` inside a VPC for DPDP Act
2023, RDS is not publicly reachable, and cost is predictable under load.
