# LEED Phase 1 Architecture: Database & Owner Authentication

LEED is a private, single-owner Global Lead Intelligence & Sales Automation Platform designed for autonomous, standalone production deployment without proprietary cloud lock-in.

---

## 1. Approved 12-Table Relational Schema Architecture

The relational architecture implements normalized tables with primary keys, foreign keys, cascade/set null rules, and relational indexes.

| # | Table Name | Purpose | Primary Key | Foreign Keys & Constraints |
|---|------------|---------|-------------|----------------------------|
| 1 | `owner_users` | Single-owner private authentication | `id` (TEXT) | `UNIQUE (email)` |
| 2 | `owner_sessions` | Revocable cryptographic session tokens | `id` (TEXT) | `REFERENCES owner_users(id) ON DELETE CASCADE`, `UNIQUE (token_hash)` |
| 3 | `pipeline_stages` | Sales pipeline visual stages | `id` (TEXT) | Ordered index on `display_order` |
| 4 | `leads` | Canonical, verified lead entity | `id` (TEXT) | `REFERENCES pipeline_stages(id) ON DELETE SET NULL` |
| 5 | `lead_sources` | Immutable provenance tracking for every data point | `id` (TEXT) | `REFERENCES leads(id) ON DELETE CASCADE` |
| 6 | `lead_identifiers` | Verified registration IDs (CRN, OrgNr, ABN, Domain) | `id` (TEXT) | `REFERENCES leads(id) ON DELETE CASCADE`, `UNIQUE (lead_id, type, value)` |
| 7 | `lead_notes` | Free-form operational observations | `id` (TEXT) | `REFERENCES leads(id) ON DELETE CASCADE` |
| 8 | `activities` | Timeline touchpoints (calls, inspections, stages) | `id` (TEXT) | `REFERENCES leads(id) ON DELETE CASCADE` |
| 9 | `tasks` | Action items and follow-ups | `id` (TEXT) | `REFERENCES leads(id) ON DELETE SET NULL` |
| 10 | `lead_merge_history` | Complete historical audit of merged lead snapshots | `id` (TEXT) | `REFERENCES leads(id) ON DELETE CASCADE` |
| 11 | `campaigns` | Outreach templates and cadence configuration | `id` (TEXT) | `channel`, `status` |
| 12 | `campaign_messages` | Dispatched / pending-approval messages | `id` (TEXT) | `REFERENCES campaigns(id) ON DELETE CASCADE`, `REFERENCES leads(id) ON DELETE CASCADE` |

### Supporting Operational Tables:
- `schema_migrations`: Version tracking and rollback management for DDL scripts.
- `connector_credentials` & `connector_runs`: Health, telemetry, and rate-limit audit records for all live external providers.
- `audit_events`: Security event log (logins, credential changes, data export).
- `app_settings`: Global single-owner platform configuration (rate limits, crawl policies, suppression lists).

---

## 2. Safe JSON-to-PostgreSQL Migration Runbook

The application includes a dual-engine architecture:
- Primary Engine: PostgreSQL (when `DATABASE_URL` is configured and reachable).
- Safe Preserved Engine: `data/pipeline_store.json` (intact, never deleted or overwritten).

### Migration Execution Procedure:
1. **Automated Backup**:
   The migrator automatically creates a timestamped copy at `data/backups/pipeline_store_backup_<timestamp>.json` prior to any processing.
2. **Dry-Run Validation**:
   Run the migration with `dryRun: true` via API `POST /api/database/migrate-json` with `{ "dryRun": true }`.
   This tests all relational mappings, verifies foreign keys, detects duplicate identifiers, and rolls back the database transaction without committing.
3. **Live Migration**:
   Run with `{ "dryRun": false }`. All stages, leads, sources, identifiers, notes, activities, tasks, campaigns, and settings are inserted into PostgreSQL inside a single transaction. If any error occurs, the transaction rolls back cleanly.

---

## 3. Single-Owner Security Architecture

### Strict Isolation Rules:
- No public user registration.
- No employee/sub-user accounts.
- No multi-tenant partitioning.
- Initial setup endpoint (`POST /api/auth/setup`) locks immediately after first owner registration; subsequent attempts are permanently rejected with HTTP 400/403.

### Security Controls:
1. **Mathematical Single-Owner Singleton Constraint**:
   - `owner_users` implements a dual-constraint database guarantee:
     1. `uq_owner_singleton UNIQUE (is_singleton)`
     2. `chk_owner_singleton CHECK (is_singleton = TRUE)`
   - This prevents any row insertion where `is_singleton = false` (blocked by CHECK constraint) or where `is_singleton = true` if another row already exists (blocked by UNIQUE constraint). Exactly one owner row can ever exist in the database.
2. **Password Hashing**:
   - Uses `bcryptjs` with 12 salt rounds (Argon2-equivalent high-cost work factor), resistant to GPU brute-force attacks.
3. **Session Security & Dual Auth**:
   - 32-byte cryptographic random session token generated using Node.js `crypto.randomBytes(32)`.
   - The raw token is stored in the client's secure, partitioned HTTP-only cookie (`leed_session`, with `SameSite: None`, `Secure: true`, `Partitioned: true` for CHIPS support) and held in client memory/localStorage as a resilient fallback in cross-origin iframe environments.
   - The database stores only the SHA-256 hash of the token (`token_hash`), protecting active sessions even against database snapshot leaks.
   - Sessions can be revoked individually on logout or en masse during password reset.
4. **Sliding-Window Rate Limiting**:
   - `LoginRateLimiter` enforces a maximum of 5 failed attempts within 15 minutes per IP.
   - Lockout period: 15 minutes. Resets automatically upon successful authentication.
5. **CSRF Protection**:
   - Double-submit and custom header validation via `x-leed-csrf-token`.
   - Verified by `validateCsrf` on all state-mutating requests (`POST`, `PUT`, `DELETE`).
   - Cross-origin requests blocked by comparing `Origin` and `Referer` headers against `Host`.

---

## 4. Phase 2 Cryptographic Audit Log Architecture (`audit_events`)

### 1. Database-Level Immutability Triggers:
- **Row-Level Modification Blocker**:
  `trg_audit_events_prevent_update_delete` executes `BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW` and raises an exception with error code `55000` (prohibited operation).
- **Statement-Level Truncation Blocker**:
  `trg_audit_events_prevent_truncate` executes `BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT` and blocks any `TRUNCATE TABLE audit_events;` statements.

### 2. Sequential Cryptographic Hash Chaining:
- Every audit record contains:
  - `sequence_number BIGINT NOT NULL UNIQUE` (strictly contiguous: 1, 2, 3...)
  - `prev_hash TEXT NOT NULL` (hash of the immediately preceding event, or 64 zeros genesis hash)
  - `current_hash TEXT NOT NULL` (SHA-256 hexadecimal digest)
  - `hash_version INTEGER NOT NULL DEFAULT 1`
- **Genesis Baseline**:
  `0000000000000000000000000000000000000000000000000000000000000000` (RFC 6962 standard baseline).
- **Canonical Hash Payload**:
  `sequence_number|id|action|actor_email|entity_type|entity_id|details|ip_address|created_at(ISO)|prev_hash`
- **Concurrency Safety**:
  The insertion trigger acquires a PostgreSQL advisory transaction lock (`pg_advisory_xact_lock(hashtext('audit_events_chain_lock'))`) and queries the chain head with `FOR UPDATE`. This guarantees strictly contiguous sequence numbers and unbreakable hash chaining even under concurrent requests.
- **Verification API**:
  `GET /api/owner/audit-log/verify` mathematically validates the chain from Genesis to Head, confirming sequence continuity and recalculating SHA-256 digests. If any entry is missing, altered, or spliced, it reports the exact sequence number and discrepancy.

### 3. Documented Limitations & WORM Recommendation:
- **Schema Owner Privilege Limitation**: The application connects using a database role that owns the relational schema. Therefore, a compromised application or direct database superuser could drop or alter triggers (`ALTER TABLE DISABLE TRIGGER`).
- **Enterprise WORM Checkpoint Recommendation**: To achieve full Write-Once-Read-Many tamper-proof compliance, the application head hash should be periodically committed to an external immutable ledger or cloud WORM storage bucket (e.g. AWS S3 Object Lock in Compliance Mode, Google Cloud Storage Bucket Lock, or an external transparency log) with independent credentials.

---

## 5. Bearer-Token vs Cookie-Only Authentication Investigation

### Empirical Findings in Google AI Studio Iframe:
1. **Third-Party Iframe Storage Partitioning (CHIPS)**:
   - Google AI Studio embeds web applets inside cross-site `<iframe>` elements (`aistudio.google.com` embedding `ais-dev-...run.app`).
   - While `Partitioned; SameSite=None; Secure` cookies work in modern desktop Chrome, they can be silently dropped or blocked in Safari (WebKit Intelligent Tracking Prevention), Firefox (Enhanced Tracking Protection), iOS WebView contexts, or incognito mode.
   - If third-party partitioned cookies are blocked, `document.cookie` is empty, causing CSRF token extraction and session cookie delivery to fail entirely.
2. **Dual Authentication Resilience**:
   - The application implements a cookie-first strategy: `requireOwnerAuth` checks `req.cookies?.leed_session` first. If absent, it seamlessly validates `req.headers['authorization']` (`Bearer <token>`).
   - Client-side, tokens are securely held in `localStorage` (`leed_session_token`) under the origin of the iframe document.
   - Removing the localStorage Bearer fallback prematurely would risk locking out users across browser reloads and iframe navigations.
3. **Safe Migration Strategy**:
   - Maintain the dual-authentication model for development previews and cross-origin iframe deployments.
   - Introduce client-side cookie capability telemetry (`/api/auth/telemetry`) to monitor cookie persistence across user sessions.
   - Only consider disabling the localStorage fallback for dedicated standalone custom-domain production deployments where the application is accessed as a first-party top-level document.

---

## 4. Standalone Deployment Guide (Outside AI Studio)

LEED is built using standard Node.js, Express, React, and PostgreSQL, and can be deployed anywhere with zero AI Studio dependencies:

### Option A: Docker / Container
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist-server/server.js"]
```

### Option B: Node.js VPS / Linux Service
```bash
# 1. Clone repository
git clone https://github.com/mahasubramanyam/LEED.git /opt/leed
cd /opt/leed

# 2. Configure environment
cp .env.example .env
nano .env # Set DATABASE_URL and secrets

# 3. Install and build
npm install
npm run build

# 4. Start production service
npm run start
```
