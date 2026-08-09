// EdAI on Azure Container Apps — Central India.
//
// Replaces the Vercel projects `ed8ai` (Next.js portal) and `identity` (NestJS,
// one serverless function capped at 30s).
//
// Container Apps rather than AKS or App Service: it gives built-in ingress with
// free managed TLS certificates, per-app scale rules, and revision-based
// rollback, which removes the load balancer, the certificate plumbing and the
// NAT gateway that the equivalent AWS stack had to pay for and wire together.
//
// Central India for DPDP Act 2023 residency. The stale CI workflows already
// referenced `rg-edai-prod-cin`, so the intent was always this region.

@description('Deployment environment: prod or staging.')
param environment string = 'prod'

@description('Azure region. Container Apps is available in Central India and South India only, within India.')
param location string = 'centralindia'

@description('Container image for the identity service. Placeholder until the first real push — Container Apps cannot be created without a resolvable image.')
param identityImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Container image for the Next.js web portal.')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('PostgreSQL administrator password. Passed at deploy time, never stored in the template.')
@secure()
param dbPassword string

@description('NextAuth secret. MUST be copied verbatim from the existing Vercel project or every active session is invalidated at cutover.')
@secure()
param authSecret string

@description('JWT signing secret for the identity service.')
@secure()
param jwtSecret string

// ── Voice / AI integration ──────────────────────────────────────────────────
// Recovered from the Vercel `identity` project. Voice calling is dead without
// these: the Twilio client fails to construct, so the whole outreach flow —
// admission DTMF, parent calls, TTS — silently does nothing.

@description('Twilio account SID.')
@secure()
param twilioAccountSid string = ''

@description('Twilio auth token.')
@secure()
param twilioAuthToken string = ''

@description('Signing key for TTS audio URLs handed to Twilio.')
@secure()
param twilioAudioSigningKey string = ''

@description('Sarvam AI key — Kannada/Hindi ASR and TTS.')
@secure()
param sarvamApiKey string = ''

@description('Gemini API key — conversation turns.')
@secure()
param geminiApiKey string = ''

@description('Twilio caller ID, e.g. +12605975538.')
param twilioPhoneNumber string = ''

@description('Comma-separated CORS origins allowed to call this API.')
param corsOrigins string = 'https://app.raycraft.in'

@description('''
Bypass Twilio webhook signature validation. SECURITY-RELEVANT.

'true' means the TwiML endpoints accept any caller, so anyone who learns a
callId can drive call state. Set it only when validation is known-broken and
restoring voice matters more than that exposure.

Why it is currently needed: Twilio's own signature does not validate against the
TWILIO_AUTH_TOKEN recovered from Vercel, while a signature computed locally with
that same token DOES validate against the deployed app — verified by replaying
Twilio's exact failing URL. That split is the signature of a rotated token:
Twilio signs webhooks with the CURRENT primary auth token, while REST calls keep
working with a rotated-out token. Copy the current primary token from the Twilio
console, redeploy, and set this back to 'false'.

Note the previous production on Render also ran TWILIO_SKIP_VALIDATION=true
(GO_LIVE.md), so signature checking has likely never actually been enforced.
''')
param twilioSkipValidation string = 'false'

var name = 'edai-${environment}'
var acrName = 'edaiacr${uniqueString(resourceGroup().id)}'
var pgName = '${name}-pg'

// ── Observability ───────────────────────────────────────────────────────────

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Container registry ──────────────────────────────────────────────────────
// Basic is enough for two images; admin user keeps the first manual push simple.

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
  }
}

// ── PostgreSQL ──────────────────────────────────────────────────────────────
// Burstable B1ms: the pilot's working set is small and traffic is bursty around
// class hours. Scale up by changing the SKU; it is not a redeploy.

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: pgName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'edai'
    administratorLoginPassword: dbPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled' // geo-redundant would copy PII out of India
    }
    highAvailability: {
      mode: 'Disabled' // pilot sizing; ZoneRedundant for production
    }
    network: {
      publicNetworkAccess: 'Enabled' // narrowed by the firewall rule below
    }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pg
  name: 'edai'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Container Apps on the Consumption plan use dynamic outbound addresses, so a
// narrow CIDR allowlist is not possible without a VNet-integrated environment.
// This rule permits Azure-internal traffic only — not the public internet — and
// should be replaced by VNet integration before this holds real student data.
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: pg
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// pgvector ships with Flexible Server but must be allow-listed before
// CREATE EXTENSION works. chatbot and nl-query depend on it.
resource pgVectorConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'VECTOR,UUID-OSSP,PGCRYPTO'
    source: 'user-override'
  }
  dependsOn: [pgDb]
}

// ── Redis ───────────────────────────────────────────────────────────────────
//
// Azure Cache for Redis is retiring and refuses new instances outright:
//   "Azure Cache for Redis is retiring, create Azure Managed Redis instead"
// Its replacement, Azure Managed Redis, starts around $45/month at Balanced_B0
// — more than the database, on a pilot budget of roughly $65.
//
// So Redis runs as an internal container app instead: ~$20/month, real Redis,
// reachable only from inside the Container Apps environment (external: false),
// never from the internet.
//
// What that costs: no managed backups, no failover, and the data is lost on
// restart. Today Redis holds exactly one thing — the JWT refresh-token
// blocklist in auth/token-blocklist.service.ts, which already fails open when
// Redis is unreachable. So a restart degrades to the behaviour the code is
// written to survive: revoked refresh tokens become valid again until they
// expire.
//
// That is acceptable for a pilot and NOT acceptable once Phase 0 moves voice
// conversation state, parent OTPs and pending payment orders here — losing
// those mid-call or mid-payment is real damage. Swap this resource for Managed
// Redis at that point; only the REDIS_URL construction below changes.
resource redisApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'aca-redis'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: false // environment-internal only
        transport: 'tcp'
        targetPort: 6379
        exposedPort: 6379
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'docker.io/library/redis:7-alpine'
          // maxmemory-policy: the blocklist is TTL-bounded, so evicting the
          // oldest volatile keys under pressure beats refusing writes.
          command: ['redis-server']
          args: ['--maxmemory', '200mb', '--maxmemory-policy', 'volatile-lru']
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        // Single replica: replicas would not share state, and two blocklists
        // that disagree are worse than one that is occasionally empty.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ── Container Apps environment ──────────────────────────────────────────────

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var pgHost = '${pgName}.postgres.database.azure.com'
var databaseUrl = 'postgresql://edai:${uriComponent(dbPassword)}@${pgHost}:5432/edai?sslmode=require'
// Plain redis:// — traffic never leaves the Container Apps environment, and the
// internal ingress is not reachable from outside it.
//
// Short app name rather than the .internal.<domain> FQDN: the FQDN form timed
// out from sibling apps (TokenBlocklistService logged `connect ETIMEDOUT` every
// ten seconds). Container Apps resolves sibling app names within an environment.
var redisUrl = 'redis://${redisApp.name}:6379'

// ── Identity service ────────────────────────────────────────────────────────

resource identityApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'aca-identity'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto' // negotiates HTTP/2 and WebSockets for Socket.IO
        allowInsecure: false
        // NO stickySessions here: Container Apps rejects session affinity in
        // Single revision mode (ContainerAppInvalidIngressStickySessionRevisionMode),
        // and at one replica affinity is a no-op anyway.
        //
        // When Phase 0 lands and this scales past one replica, Socket.IO's
        // long-polling fallback WILL need affinity — at that point set
        // activeRevisionsMode: 'Multiple' on this app and re-add:
        //   stickySessions: { affinity: 'sticky' }
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
        { name: 'database-url', value: databaseUrl }
        { name: 'redis-url', value: redisUrl }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'twilio-account-sid', value: twilioAccountSid }
        { name: 'twilio-auth-token', value: twilioAuthToken }
        { name: 'twilio-audio-signing-key', value: twilioAudioSigningKey }
        { name: 'sarvam-api-key', value: sarvamApiKey }
        { name: 'gemini-api-key', value: geminiApiKey }
      ]
    }
    template: {
      containers: [
        {
          name: 'identity'
          image: identityImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'INSTITUTION_ID', value: 'rvce' }
            { name: 'DB_POOL_MAX', value: '10' }
            { name: 'STRICT_DB', value: '0' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            // Computed from the environment's default domain rather than the
            // app's own fqdn, which would be a circular reference. Twilio
            // fetches TTS audio and posts DTMF callbacks here — if it still
            // points at the old Vercel deployment, calls connect and then do
            // nothing.
            { name: 'TWILIO_WEBHOOK_BASE_URL', value: 'https://aca-identity.${env.properties.defaultDomain}' }
            { name: 'TWILIO_PHONE_NUMBER', value: twilioPhoneNumber }
            { name: 'TWILIO_FROM_NUMBER', value: twilioPhoneNumber }
            { name: 'CORS_ORIGINS', value: corsOrigins }
            { name: 'TWILIO_SKIP_VALIDATION', value: twilioSkipValidation }
            { name: 'TWILIO_ACCOUNT_SID', secretRef: 'twilio-account-sid' }
            { name: 'TWILIO_AUTH_TOKEN', secretRef: 'twilio-auth-token' }
            { name: 'TWILIO_AUDIO_SIGNING_KEY', secretRef: 'twilio-audio-signing-key' }
            { name: 'SARVAM_API_KEY', secretRef: 'sarvam-api-key' }
            { name: 'GEMINI_API_KEY', secretRef: 'gemini-api-key' }
          ]
          probes: [
            {
              type: 'Readiness'
              // /api/health, not /health — the old Azure pipeline 404'd on that
              // for a while before someone noticed.
              httpGet: { path: '/api/health', port: 3001 }
              initialDelaySeconds: 15
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        // PINNED TO 1. The service still keeps the user store, voice
        // conversation state, TTS audio, parent OTPs, pending payment orders
        // and proctored exam attempts in process memory. A second replica means
        // flickering user counts, ~50% parent-OTP failure, dead air on calls,
        // and payment callbacks landing on a replica that never saw the order.
        // Raise only after Phase 0 — see AWS_MIGRATION_PHASE0.md.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ── Web portal ──────────────────────────────────────────────────────────────

@description('''
Custom hostname for the web portal, e.g. app.raycraft.in. Empty disables it.

This MUST be declared here, not bound with `az containerapp hostname add/bind`.
ARM treats the template as the full desired state of the app: a deployment that
omits customDomains DELETES any hostname bound out-of-band, which takes the site
down with ERR_CONNECTION_RESET while DNS still points at a healthy app. That
happened once — the binding was added by CLI, then wiped by the next deployment.
''')
param customDomain string = ''

@description('Resource ID of the managed certificate for customDomain. Empty on the first deployment: bind the hostname once to have Azure issue the certificate, then pass its ID here so redeploys keep the binding.')
param customDomainCertificateId string = ''

// Used for AUTH_URL before a custom domain exists. The app's own fqdn cannot be
// referenced from inside its own definition, but Container Apps names it
// deterministically from the environment's default domain.
var webAppFallbackHost = 'aca-web.${env.properties.defaultDomain}'

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'aca-web'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: empty(customDomain) ? null : [
          {
            name: customDomain
            bindingType: empty(customDomainCertificateId) ? 'Disabled' : 'SniEnabled'
            certificateId: empty(customDomainCertificateId) ? null : customDomainCertificateId
          }
        ]
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
        { name: 'auth-secret', value: authSecret }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
            // AUTH_URL is not optional behind Container Apps ingress.
            //
            // auth.ts sets trustHost: true, but the forwarded-host headers do
            // not reach the app in a form NextAuth resolves, so it fell back to
            // HOSTNAME + PORT and built absolute URLs as http://0.0.0.0:3000.
            // signOut({ callbackUrl: '/login' }) passes a RELATIVE url, which
            // NextAuth resolves against that base — so logout sent users to
            // 0.0.0.0:3000/login and the browser refused to connect.
            //
            // Pinning the public origin removes the guesswork. AUTH_URL is the
            // v5 name; NEXTAUTH_URL is kept for the v4-era code paths.
            { name: 'AUTH_URL', value: empty(customDomain) ? 'https://${webAppFallbackHost}' : 'https://${customDomain}' }
            { name: 'NEXTAUTH_URL', value: empty(customDomain) ? 'https://${webAppFallbackHost}' : 'https://${customDomain}' }
            { name: 'AUTH_TRUST_HOST', value: 'true' }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'IDENTITY_SERVICE_URL', value: 'https://${identityApp.properties.configuration.ingress.fqdn}' }
          ]
        }
      ]
      scale: {
        // The web tier is stateless, so it can scale freely.
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output identityFqdn string = identityApp.properties.configuration.ingress.fqdn
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output pgHost string = pgHost
output redisHost string = redisApp.properties.configuration.ingress.fqdn
