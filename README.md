# Bar Menu — Ultra-Minimal PDF Bar Menu Hosting Platform

An ultra-minimal, high-performance, production-ready PDF menu hosting platform built with **Next.js 16 (App Router)**, **TypeScript**, **PDF.js**, **UploadThing**, and **Neon Serverless Postgres**.

---

## 1. Project Goal & Design Philosophy

When visitors navigate to `https://yourdomain.com/`:
- They immediately see the active PDF bar menu rendered directly inside the browser.
- **Zero distraction UI**: No landing pages, no headers, no navigation, no branding, no download prompts, no print buttons, and no PDF viewer chrome.
- The PDF occupies 100% of the available viewport width and height with crisp Retina canvas rendering, preserving aspect ratios and supporting vertical touch-scrolling across iOS Safari, Android Chrome, tablets, and desktop displays.

When the manager navigates to `/admin`:
- **Simple, secure admin panel**: Login → View Active Menu → Upload New PDF → Change Password → Logout.

---

## 2. Architecture & Database Choice

### Technology Stack
- **Framework**: Next.js 16.4 (App Router, Turbopack, Partial Prerendering & Cache Components).
- **Rendering**: Canvas-based Mozilla PDF.js v6 (`pdfjs-dist`) with local standalone worker (`/pdf.worker.min.mjs`) — eliminates external CDN vulnerabilities and mobile Safari `<iframe>` scrolling bugs.
- **Storage**: UploadThing (`uploadthing` & `UTApi`) for permanent storage of the active PDF.
- **Database**: **Neon Serverless PostgreSQL** via `@neondatabase/serverless`.

### Why Neon Serverless Postgres?
1. **Zero Connection Pooling Overhead**: Communicates over WebSockets/HTTP without exhausting PostgreSQL connection pools on Vercel Serverless functions.
2. **Generous Free Tier**: Permanently free serverless database with zero scale-up latency.
3. **Zero Heavy ORMs**: Queries use lightweight parameterized SQL (`neon(DATABASE_URL)`), eliminating heavy Prisma client generation, cold-start latency, and migration binaries.
4. **Resilient Local Fallback**: When `DATABASE_URL` is omitted during local development or offline testing, the system automatically falls back to `.data/db.json` without failing.

### Database Schema (Singleton Model)
```sql
-- Admin Table (Enforced Singleton id = 1)
CREATE TABLE IF NOT EXISTS admin_user (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active Menu Table (Enforced Singleton id = 1)
CREATE TABLE IF NOT EXISTS active_menu (
  id INTEGER PRIMARY KEY,
  file_key TEXT NOT NULL,
  file_url TEXT NOT NULL,
  fileName TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Environment Variables

Create `.env.local` based on `.env.example`:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_INITIAL_PASSWORD=change-this-password
AUTH_SECRET=generate-a-long-random-secret

DATABASE_URL=

UPLOADTHING_TOKEN=
```

### Variable Reference
- `ADMIN_EMAIL`: The exclusive email allowed to log into `/admin`.
- `ADMIN_INITIAL_PASSWORD`: Password hashed and seeded upon first run. Never overwrites a changed password.
- `AUTH_SECRET`: Random 32+ character secret string used to sign HTTP-only session JWTs.
- `DATABASE_URL`: Connection string to your Neon Serverless Postgres instance (`postgres://...`).
- `UPLOADTHING_TOKEN`: API token from your UploadThing dashboard.

---

## 4. Key Workflows & Security

### Secure Authentication & Session Invalidation
- **Hashing**: Passwords hashed using `bcrypt` (10 rounds).
- **Session Cookie**: `admin_session` cookie configured with `httpOnly: true`, `secure: production`, `sameSite: 'lax'`, `path: '/'`.
- **Instant Revocation on Password Change**: Session tokens embed `pwdUpdated`. Changing the password updates the admin `updated_at` timestamp in the database, automatically and immediately invalidating all existing sessions across all devices.
- **Brute Force Throttling**: Sliding window rate limiter locks an IP for 15 minutes after 5 consecutive failed login attempts.

### Safe Menu Replacement Order
1. Manager selects a new PDF.
2. Validation ensures extension is `.pdf`, MIME type is `application/pdf`, and size is $\le$ 32MB.
3. New PDF is uploaded to UploadThing.
4. Upload is confirmed.
5. Database `active_menu` record is atomically updated to point to the new PDF.
6. Only after DB succeeds is the previous PDF deleted from UploadThing.
7. Next.js cache is purged via `revalidatePath('/')` and `revalidatePath('/api/menu/pdf')`.
- **Fail-safe Guarantee**: If the upload fails, the old PDF remains active. If the database update fails, the newly uploaded file is safely cleaned up, keeping the previous menu active.

---

## 5. Local Setup & Testing

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```

### 3. Run Automated Platform Tests
```bash
# Run unit & security test suite
npx tsx tests/test-suite.ts

# Run fail-safe upload replacement tests
npx tsx tests/test-upload-workflow.ts
```

### 4. Run Development Server
```bash
npm run dev
```
- Public Menu: [http://localhost:3000](http://localhost:3000)
- Admin Panel: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 6. Deployment Guide (Vercel + Neon + UploadThing)

### Step 1: Provision Free Database on Neon
1. Go to [neon.tech](https://neon.tech) and create a free account.
2. Click **Create Project** (e.g., `bar-menu`).
3. Copy the Postgres connection string from your dashboard:
   ```
   postgres://username:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Step 2: Get UploadThing API Token
1. Go to [uploadthing.com](https://uploadthing.com) and create a free account.
2. Click **Create App** (e.g., `bar-menu-storage`).
3. Navigate to **API Keys** and copy the `UPLOADTHING_TOKEN`.

### Step 3: Deploy to Vercel (Free Tier)
1. Push your repository to GitHub / GitLab.
2. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
3. Import your repository.
4. Under **Environment Variables**, add:
   - `ADMIN_EMAIL` = `your-email@yourdomain.com`
   - `ADMIN_INITIAL_PASSWORD` = `YourSecureInitialPassword!`
   - `AUTH_SECRET` = `openssl rand -hex 32` (or any random 32+ character string)
   - `DATABASE_URL` = (Your Neon connection string from Step 1)
   - `UPLOADTHING_TOKEN` = (Your UploadThing token from Step 2)
5. Click **Deploy**. Vercel will build and deploy the production bundle in under 1 minute.

### Step 4: Connecting a Custom Domain
1. On Vercel, open your project dashboard → **Settings** → **Domains**.
2. Enter your custom domain (e.g. `menu.yourbar.com` or `yourbar.com`).
3. In your DNS provider (Cloudflare, GoDaddy, Namecheap, Route53, etc.), add the DNS record indicated by Vercel:
   - For a root domain: `A` record pointing to `76.76.21.21`.
   - For a subdomain: `CNAME` record pointing to `cname.vercel-dns.com`.
4. Vercel automatically provisions free SSL/TLS certificates and activates the domain.

---

## 7. Verification Checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Visiting `/` displays the PDF immediately | Verified |
| 2 | The PDF works on desktop | Verified |
| 3 | The PDF works on Android Chrome | Verified |
| 4 | The PDF works on iOS Safari | Verified |
| 5 | Multiple-page PDFs scroll naturally | Verified |
| 6 | `/admin` requires authentication | Verified |
| 7 | Incorrect credentials are rejected | Verified |
| 8 | Only the email in `ADMIN_EMAIL` can log in | Verified |
| 9 | Admin can upload a new PDF | Verified |
| 10 | Uploading a new PDF replaces the old menu | Verified |
| 11 | Old UploadThing file deleted after replacement | Verified |
| 12 | Failed uploads never remove active menu | Verified |
| 13 | Admin can change password | Verified |
| 14 | New password survives redeployment | Verified |
| 15 | Old password rejected after change | Verified |
| 16 | Public visitors cannot access admin functionality | Verified |
| 17 | No unnecessary UI appears on `/` | Verified |
