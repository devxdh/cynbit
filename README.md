# Cynbit Technologies — Backend Architecture & Technical Audit

**Candidate:** Dev Dhanadiya  
**Role:** Backend Developer Intern Applicant  
**Assessment Target:** `https://www.cynbit.in/`  
**Tech Stack:** TypeScript, Node.js, Express, Zod  

---

## Project Overview

This repository contains my submission for the **Cynbit Backend Developer Intern Assessment**.

I conducted a **100% passive, non-intrusive technical audit** of Cynbit's public website (`https://www.cynbit.in/`) to analyze its backend architecture, edge routing, public form ingestion, security headers, and error handling.

Along with the audit report, I built a working, production-grade **TypeScript/Node.js backend remediation service** that directly implements fixes for every issue I identified.

---

## Deliverables Directory

All required deliverables are organized into clear, readable documents:

| Deliverable | File Link | Summary |
| :--- | :--- | :--- |
| **Deliverable 1: Backend Technical Audit Report** | [`docs/01_backend_technical_audit.md`](docs/01_backend_technical_audit.md) | Breakdown of Cynbit's hosting on Vercel Edge (Mumbai PoP), Next.js App Router, DNS records, contact form behavior, and crawler manifests. |
| **Deliverable 2: Security & Performance Findings** | [`docs/02_security_performance_findings.md`](docs/02_security_performance_findings.md) | Analysis of missing security headers, missing application rate limiting, mass-assignment risks, and information leakage. |
| **Deliverable 3: Recommended Improvements & Code** | [`docs/03_recommended_improvements.md`](docs/03_recommended_improvements.md) | Pragmatic engineering fixes: Zod schema parsing, Token Bucket rate limiting, and centralized safe error handling with Incident IDs. |
| **Production Source Code** | [`src/`](src/) | Clean, modular Express backend implementing the full defense lifecycle. |

---

## How the Remediation Pipeline Works

Here is the exact request lifecycle implemented in [`src/index.ts`](src/index.ts):

```
[ Incoming Client Request ]
             │
             ▼
┌────────────────────────────────────────────────────────┐
│ 1. Security Headers Middleware                         │
│    - Strips 'X-Powered-By'                             │
│    - Adds Content-Security-Policy (CSP)                │
│    - Adds Strict-Transport-Security (HSTS)             │
│    - Adds X-Frame-Options: DENY (anti-clickjacking)    │
│    - Adds X-Content-Type-Options: nosniff              │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 2. Request Body Parser                                 │
│    - Hard cap of 10kb to stop memory bloat             │
│    - Catches malformed JSON syntax early               │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 3. In-Memory Token Bucket Rate Limiter                 │
│    - Max 5 requests per minute per IP                  │
│    - Smoothly refills over time                        │
│    - Over budget? -> Returns HTTP 429 with Retry-After │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 4. Zod Strict Schema Validation                        │
│    - Checks fullName, email, phone (E.164), message    │
│    - .strict(): Rejects unknown fields immediately     │
│    - Invalid data? -> Returns HTTP 422 with field info │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 5. Inquiry Route Controller                            │
│    - Generates unique inquiryId tracking UUID          │
│    - Returns HTTP 201 Created                          │
└────────────────────────┬───────────────────────────────┘
                         │
    (On Any Error)       ▼
┌────────────────────────────────────────────────────────┐
│ 6. Centralized Error Handler                           │
│    - Formats 422 validation errors cleanly             │
│    - Masks 500 errors; logs full stack trace only to   │
│      server console and gives client an incidentId     │
└────────────────────────────────────────────────────────┘
```

---

## Setup & Verification Guide

### 1. Prerequisites
- Node.js (v20+ recommended)
- npm

### 2. Install Dependencies & Build
```bash
# Clone the repository
git clone <repo-url>
cd cynbit-backend-audit

# Install dependencies
npm install

# Compile TypeScript
npm run build
```

### 3. Run the Server
```bash
# Start the production compiled build
npm start

# Or start in development mode with live reloads
npm run dev
```
The server will start on port `3000` (or `PORT` environment variable).

---

## Testing with `curl` Commands

### 1. Test Health & Security Headers
Verify that security headers are active and `X-Powered-By` is hidden:
```bash
curl -i http://localhost:3000/health
```

### 2. Submit a Valid Inquiry (Expect HTTP 201)
```bash
curl -i -X POST http://localhost:3000/api/inquiry \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Dev Dhanadiya",
    "email": "dev@example.com",
    "phone": "+918947962667",
    "subject": "TECHNICAL_CONSULTING",
    "message": "Inquiry regarding backend architecture and systems engineering."
  }'
```

### 3. Test Unknown Field Rejection (Expect HTTP 422)
Attempt to inject extra unauthorized fields (`role: admin`) to see Zod `.strict()` in action:
```bash
curl -i -X POST http://localhost:3000/api/inquiry \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Malicious User",
    "email": "test@example.com",
    "subject": "GENERAL_INQUIRY",
    "message": "Testing mass assignment protection.",
    "role": "admin",
    "isAdmin": true
  }'
```
*Result: Server rejects the request with HTTP 422 and clearly states that `role` and `isAdmin` are unrecognized keys.*

### 4. Test Rate Limiter (Expect HTTP 429 on 6th request)
Send 6 rapid requests from the same IP:
```bash
for i in {1..6}; do
  curl -i -X POST http://localhost:3000/api/inquiry \
    -H "Content-Type: application/json" \
    -d '{
      "fullName": "Dev Dhanadiya",
      "email": "dev@example.com",
      "subject": "GENERAL_INQUIRY",
      "message": "Testing the rate limiter."
    }'
done
```
*Result: The 6th request is blocked with HTTP 429 and includes a `Retry-After: 12` header.*

### 5. Test Error Masking (Expect HTTP 500 with Incident ID)
Trigger a simulated backend fault to see error masking:
```bash
curl -i http://localhost:3000/api/simulate-fault
```
*Result: The client gets a safe JSON response with a unique `incidentId`. The real database error and stack trace are logged strictly to the server terminal.*

---

## Automated All-in-One Test Script

You can also run all tests automatically in one command:
```bash
chmod +x test.sh
./test.sh
```

---

## Source Code Structure

```
src/
├── index.ts                      # Express app setup & middleware pipeline
├── schemas/
│   └── contactPayload.ts         # Zod schema with .strict() and bounds
└── middleware/
    ├── rateLimiter.ts            # Token Bucket rate limiter (5 req / 60s)
    ├── securityHeaders.ts        # CSP, HSTS, X-Frame-Options, MIME protection
    └── errorHandler.ts           # Formatted 422s & masked 500s with incidentId
```
