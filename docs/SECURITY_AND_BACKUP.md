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

### 3.3 Restoration Checklist
1. Verify target Neon database TLS connectivity (`GET /api/owner/security-posture`).
2. Restore schema & data from Neon PITR branch or `pg_restore`:
   ```bash
   pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-acl leed_backup_<timestamp>.dump
   ```
3. Run `GET /api/owner/audit-log/verify` in the Owner Control Centre to confirm 100% contiguous SHA-256 hash chain integrity after restoration.
4. Re-verify connector credential decryption status (`GET /api/connectors/encryption-status`) using the preserved `CONNECTOR_ENCRYPTION_KEY`.
