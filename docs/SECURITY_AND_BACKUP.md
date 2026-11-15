# LEED — Security, Data Protection & Backup Guide

## 1. Encryption Boundaries (Important Distinction)

LEED separates application-layer encryption from Neon cloud infrastructure encryption:

| Layer | Scope | Implementation | Key Management |
| :--- | :--- | :--- | :--- |
| **Application-Layer Secret Encryption** | External connector credentials (`connector_credentials.encrypted_payload`) | Node.js `crypto` **AES-256-GCM** with unique 12-byte random IV and 16-byte authentication tag per entry (`key_version = 1`) | Server-side `CONNECTOR_ENCRYPTION_KEY` environment variable (SHA-256 derived 32-byte key if non-hex/base64, or direct 32-byte hex/base64). Never sent to browser clients. |
| **Password & Session Cryptography** | Owner authentication (`owner_users`, `owner_sessions`) | **bcrypt** (cost factor 12) password hashes; **SHA-256** digested 256-bit random bearer/cookie tokens | Server-generated CSPRNG (`crypto.randomBytes`). Raw session tokens are never stored in PostgreSQL. |
| **Audit Chain Integrity** | Tamper detection (`audit_events`) | Sequential **SHA-256** hash chain (`prev_hash` + canonical JSON payload) + PostgreSQL triggers blocking `UPDATE`, `DELETE`, and `TRUNCATE` | Database-enforced triggers (`trg_audit_events_prevent_update_delete`, `trg_audit_events_prevent_truncate`). |
| **Transport Encryption (TLS)** | App <-> Neon PostgreSQL & Browser <-> Express | PostgreSQL TLS (`ssl_is_used()` / `sslmode=require`) & HTTPS reverse proxy with `Strict-Transport-Security` | Neon-managed TLS certificates & hosting platform TLS termination. |
| **Infrastructure At-Rest Encryption** | Full CRM tables (`leads`, `persons`, `notes`, `activities`, `audit_events`, etc.) | **Neon Cloud Platform Storage Encryption** | Managed by Neon Cloud infrastructure (AWS/GCP storage encryption). Individual CRM rows are not separately client-side encrypted to preserve relational indexing, search, and foreign keys. |

> **Operational Rule:** Never rotate or delete `CONNECTOR_ENCRYPTION_KEY` without first rotating stored connector credentials, or existing encrypted secrets in `connector_credentials` will fail GCM authentication tag verification.

---

## 2. PII & Business Data Protection Controls

- **Single-Owner Access Control:** All `/api/*` data endpoints (except public health/CSRF/setup-status/login/logout) enforce `requireOwnerAuth` + single-owner singleton DB constraint (`uq_owner_singleton`) + fail-closed `Origin`/`Referer` and double-submit CSRF verification.
- **Browser Storage & XSS Defense:**
  - Strict `Content-Security-Policy` headers (with Google AI Studio `frame-ancestors` compatibility) and `X-Content-Type-Options: nosniff`.
  - All user/imported/discovered external URLs (`website`, `linkedinUrl`, `sourceUrl`) are sanitized via `sanitizeExternalUrl()` (`http:`/`https:` only) before rendering in `<a href>` attributes.
  - Sensitive API keys (`GEMINI_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `CONNECTOR_ENCRYPTION_KEY`, `DATABASE_URL`) are strictly server-side and redacted from logs and error responses via `redactSecrets()` and `sanitizeApiError()`.
- **Memory & Upload Minimization:**
  - CSV/XLSX import uploads are capped at 15 MB (`MAX_IMPORT_FILE_BYTES`), verified via magic bytes, scanned for Zip-bombs and VBA macros (`vbaProject.bin`), and CSV raw file buffers are zeroed immediately after parsing (XLSX buffers are released on commit).
  - Security-sensitive exports (`/api/export/csv`, `/api/export/json`, `/api/discovery/export/:searchId`, `/api/import/batches/:batchId/export`) are rate-limited, sanitize `Content-Disposition` filenames, and emit immutable `audit_events` records.

---

## 3. Backup & Disaster Recovery Strategy

### 3.1 Primary Database Backups (Neon PostgreSQL)
1. **Neon Instant Branching & Point-in-Time Recovery (PITR):**
   - Before approving any schema migration or performing large bulk imports, verify the Neon project dashboard has PITR history active and create a named Neon recovery branch if needed.
2. **Logical Snapshot (`pg_dump`):**
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl -f leed_backup_$(date +%Y%m%d_%H%M%S).dump
   ```
   Store `.dump` files encrypted offline or in a restricted private bucket — never commit dumps containing CRM data or encrypted credentials into Git.

### 3.2 Local Legacy Store Backups (`data/backups/`)
- Pre-migration JSON fallback snapshots reside in `data/backups/pipeline_store_backup_*.json` (created automatically by `server/storage.ts` on local fallback writes).
- Use `POST /api/database/migrate-json` with `{ "dryRun": true }` first to inspect reconciliation counts before importing legacy JSON backups into PostgreSQL.

### 3.3 Restoration Drill Status & Owner Verification Procedure

- **Automated / Runtime Environment Drill Status:** `NOT TESTED` in the application container runtime (PostgreSQL CLI binaries `pg_dump` / `pg_restore` / `psql` are absent and no non-production staging branch is automatically provisioned).
- **Owner-Operated Isolated Branch Verification Procedure:**
  1. Create an isolated recovery branch in Neon Console (`Branches -> Create branch` from point-in-time or current `main`) — never run `pg_restore --clean` against production `main`.
  2. Export a logical backup snapshot from a read replica / branch URI:
     ```bash
     pg_dump "$NEON_SOURCE_URL" --format=custom --no-owner --no-acl -f leed_backup_$(date +%Y%m%d_%H%M%S).dump
     ```
  3. Restore into a clean isolated target branch (`$NEON_RECOVERY_BRANCH_URL`):
     ```bash
     pg_restore --dbname="$NEON_RECOVERY_BRANCH_URL" --clean --if-exists --no-owner --no-acl leed_backup_<timestamp>.dump
     ```
  4. Verify all four acceptance invariants on the restored branch before promoting or relying on recovery:
     - `SELECT version, name FROM schema_migrations ORDER BY version;` confirms `001` through `005` recorded.
     - All **23** core tables exist (`schema_migrations`, `owner_users`, `owner_sessions`, `pipeline_stages`, `leads`, `lead_sources`, `lead_identifiers`, `lead_notes`, `activities`, `tasks`, `campaigns`, `campaign_messages`, `lead_merge_history`, `connector_credentials`, `connector_runs`, `audit_events`, `app_settings`, `country_source_capabilities`, `persons`, `company_person_relationships`, `import_mapping_templates`, `import_batches`, `import_batch_rows`).
     - Row counts of `leads`, `owner_users`, and `connector_credentials` match pre-backup counts.
     - Run `GET /api/owner/audit-log/verify` against the restored database to confirm 100% contiguous `audit_events` SHA-256 hash chain integrity and verify `CONNECTOR_ENCRYPTION_KEY` decrypts stored credentials via `GET /api/connectors/encryption-status`.
  5. Delete the temporary recovery branch after verification completes.

---

## 4. Deployment Topology & Rate-Limiting Assessment

- **Current Architecture (`server.ts`, `metadata.json`):** Single-owner private Node.js/Express application running on port `3000` with `trust proxy = 1` behind the AI Studio Cloud Run HTTPS reverse proxy.
- **Process-Local In-Memory Limiters (`LoginRateLimiter` + 8 `SlidingWindowRateLimiter` instances):**
  - **Sufficient for single-instance deployment (`max-instances = 1`)** because all traffic reaches one Node process and memory is bounded (`MAX_LOGIN_ENTRIES = 2000`, `MAX_TRACKED_KEYS = 2000`, expired-window pruning).
  - **Limitation for horizontal scaling (`max-instances > 1`):** In-memory Maps are process-local; if multiple Cloud Run containers are scaled concurrently, per-IP budgets divide across containers and `blockedCount` resets on cold restarts.
  - **Scaling Upgrade Path (No Redis Required):** If multi-instance autoscaling is ever enabled, back `LoginRateLimiter` and `SlidingWindowRateLimiter` with a lightweight `rate_limit_buckets` table in the existing Neon PostgreSQL database using atomic `INSERT ... ON CONFLICT (bucket_key) DO UPDATE` + `NOW()` window resets.

