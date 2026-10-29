# Security & Performance Findings

**Auditor:** Dev Dhanadiya  
**Role:** Backend Developer Intern Applicant  
**Target:** `https://www.cynbit.in/`

---

## Overview

During my passive technical review of Cynbit's public website, I identified 4 main areas where backend security and performance can be leveled up:
1. Missing browser security headers and open CORS on main pages.
2. Lack of application-level rate limiting on public form submissions.
3. Lack of strict server-side payload boundary checks (mass-assignment risk).
4. Leaking server details and backend paths via headers and `robots.txt`.

Here is the breakdown of each finding in plain English, explaining what is happening, why it matters, and how to fix it.

---

### Finding 1: Missing Standard Browser Security Headers

- **Severity:** High
- **What was observed:**  
  When checking the HTTP response headers with `curl -I https://www.cynbit.in/`:
  - `Content-Security-Policy` (CSP) is completely missing.
  - `X-Frame-Options` is missing.
  - `X-Content-Type-Options: nosniff` is missing.
  - `Referrer-Policy` is missing.
  - `access-control-allow-origin: *` is returned even on regular HTML pages.

- **Why this matters in real life:**
  - **Clickjacking:** Without `X-Frame-Options: DENY`, someone can embed Cynbit's website inside an invisible iframe on their own malicious site and trick users into clicking buttons they didn't intend to click.
  - **MIME Sniffing:** Without `nosniff`, old or misconfigured browsers might try to guess what a file is and execute plain text or images as JavaScript.
  - **XSS & Data Theft:** Without a `Content-Security-Policy`, if an injected script ever sneaks in through a third-party analytics tag, the browser will gladly execute it and let it send data to an attacker's server.

- **The Fix:**  
  Add an Express or Next.js middleware that injects safe default headers on every response.

---

### Finding 2: No Application-Level Rate Limiting on Contact Ingestion

- **Severity:** High
- **What was observed:**  
  Submitting inquiries via `/contact` does not expose any rate-limiting feedback (like `X-RateLimit-Remaining` or `Retry-After`). While Vercel guards against massive DDoS traffic (network level), there is no application-layer throttle stopping a bot from submitting the contact form 100 times in 10 seconds.

- **Why this matters in real life:**
  - **Email Service Exhaustion ("Denial of Wallet"):** Most contact forms trigger an email via SendGrid, Resend, or AWS SES. If an attacker spams the form, Cynbit's monthly email tier can be burnt out in an hour, racking up unexpected bills.
  - **Inbox Flooding:** Cynbit's team will have their support inbox spammed with thousands of junk inquiries.
  - **Database Bloat:** Spam submissions fill up the database table with junk rows and waste storage.

- **The Fix:**  
  Implement a Token Bucket rate limiter that allows small bursts (e.g., 5 requests) and replenishes gradually (1 request every 12 seconds per IP). Return HTTP 429 (`Too Many Requests`) with a clear `Retry-After` header when the limit is reached.

---

### Finding 3: Risk of Unvalidated or Unexpected Fields (Mass Assignment)

- **Severity:** Medium
- **What was observed:**  
  Client forms send fields like `fullName`, `email`, and `message`. In typical backend setups, developers often take `req.body` and pass it directly to an ORM or database query.

- **Why this matters in real life:**
  - **Mass Assignment:** If an attacker sends `{ "fullName": "Alice", "role": "admin", "isVerified": true }` and the backend blindly saves `req.body`, unexpected fields might be written to the database.
  - **Memory Abuse:** If someone sends a 10MB string inside the `message` field, the Node.js server spends significant CPU time parsing the JSON, causing the event loop to lag for everyone else.

- **The Fix:**  
  Use a runtime schema validation library (**Zod**) with `.strict()`. This immediately drops or rejects any key that wasn't explicitly allowed and checks string length limits before the data ever touches a database or queue.

---

### Finding 4: Information Leakage via Headers and `robots.txt`

- **Severity:** Low to Medium
- **What was observed:**
  1. The server response header `Server: Vercel` reveals the exact cloud provider and edge routing engine.
  2. Cynbit's `robots.txt` explicitly disallows `/admin/`, `/portal/`, and `/api/`.

- **Why this matters in real life:**
  - `robots.txt` does not block hackers; it only asks polite search engines not to crawl. Listing `/admin/` and `/portal/` publicly is basically giving attackers a map of where your administrative dashboards live.
  - Exposing server headers helps attackers identify what software is running so they can look up known version vulnerabilities.

- **The Fix:**
  - Strip `X-Powered-By` and obfuscate the `Server` header in production.
  - Protect admin and portal routes behind VPNs, IP whitelists, or authentication gateways rather than advertising them in `robots.txt`.

---

## Summary of Findings

| Finding | Category | Severity | Quick Takeaway |
| :--- | :--- | :--- | :--- |
| **Missing Security Headers** | Browser Security | **High** | Add CSP, X-Frame-Options, and nosniff to protect users from iframe clickjacking and script injection. |
| **No Form Rate Limiting** | Abuse Prevention | **High** | Throttle inquiry submissions to 5 per minute per IP to save email quotas and stop inbox spam. |
| **Unbounded Payload Risk** | Data Validation | **Medium**| Use Zod `.strict()` so extra fields (like `role: admin`) get rejected on the spot. |
| **Server & Route Leakage** | Information Leakage | **Low** | Hide technology headers and don't rely on `robots.txt` to hide admin endpoints. |
