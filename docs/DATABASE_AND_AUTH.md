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
1. **Password Hashing**:
   Uses `bcryptjs` with 12 salt rounds (Argon2-equivalent high-cost work factor), resistant to GPU brute-force attacks.
2. **Session Security**:
   - 32-byte cryptographic random session token generated using Node.js `crypto.randomBytes(32)`.
   - The raw token is stored in client's secure, HTTP-only cookie (`leed_session`) with `SameSite: Lax` and `path: /`.
   - The database stores only the SHA-256 hash of the token (`token_hash`), protecting active sessions even against database snapshot leaks.
   - Sessions can be revoked individually on logout or en masse during password reset.
3. **Sliding-Window Rate Limiting**:
   - `LoginRateLimiter` enforces a maximum of 5 failed attempts within 15 minutes per IP.
   - Lockout period: 15 minutes.
   - Resets automatically upon successful authentication.
4. **CSRF Protection**:
   - Double-submit and custom header validation via `x-leed-csrf-token`.
   - Automatically verified by `validateCsrf` on all state-mutating requests (`POST`, `PUT`, `DELETE`).

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
