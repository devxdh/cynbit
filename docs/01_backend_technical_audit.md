# Backend Technical Audit: Cynbit Technologies

**Auditor:** Dev Dhanadiya  
**Role:** Backend Developer Intern Applicant  
**Target:** `https://www.cynbit.in/`  
**Methodology:** 100% passive inspection (Browser DevTools, curl, public DNS) — no penetration testing or intrusive traffic.

---

## What is this document?

This report breaks down how Cynbit's current web stack works from a backend perspective. I looked at how the site handles network requests, where the servers are hosted, how caching is handled, and how public forms (like the contact page) process data.

The goal is simple: understand the existing architecture, find real-world bottlenecks or weak spots, and propose practical fixes that any backend developer on the team can maintain.

---

## 1. How I Inspected Cynbit (Passive Methodology)

To respect Cynbit's production systems, I did **not** run automated scanners, load tests, or exploit tools. Everything here was gathered using standard diagnostic utilities that any browser or developer terminal uses:

```bash
# 1. Checking HTTP response headers and caching behavior
curl -I -s -L https://www.cynbit.in/

# 2. Checking DNS routing and mail configuration
host www.cynbit.in
host -t MX cynbit.in
host -t TXT cynbit.in

# 3. Checking public search crawler rules
curl -s https://www.cynbit.in/robots.txt
```

---

## 2. Infrastructure & Hosting Setup

From the response headers and DNS lookups, here is Cynbit's current infrastructure layout:

```
[ User Browser ]
       │
       ▼ (HTTPS)
[ Vercel Anycast Edge Network ]  <-- IP: 64.29.17.65 / 216.198.79.65
       │                              Edge Node: bom1 (Mumbai, India)
       ▼
[ Next.js App Router (SSR + Server Components) ]
       │
       ▼
[ Mail / Business Services ]     <-- Microsoft 365 Exchange (cynbit-in.mail.protection.outlook.com)
```

### Key Observations:
1. **Hosting & CDN (Vercel):**  
   - Header `server: Vercel` and `x-vercel-id: bom1::...` show traffic is routed to Vercel's edge point in Mumbai (`bom1`). This gives users in India fast initial response times.
   - `x-vercel-cache: HIT` confirms edge caching is active for static assets.

2. **Application Framework (Next.js):**  
   - Headers like `vary: rsc, next-router-state-tree...` and `x-nextjs-prerender: 1` tell us the site is built with Next.js App Router, using React Server Components (RSC) and Incremental Static Regeneration (ISR).

3. **Domain & Email Setup:**  
   - `www.cynbit.in` is a CNAME pointing to `vercel-dns-017.com`.
   - Email is handled by Microsoft 365 (`cynbit-in.mail.protection.outlook.com`) with SPF verification configured (`v=spf1 include:secureserver.net -all`), protecting against email spoofing.

---

## 3. How the Contact Form Works (Ingestion Route)

I inspected the network activity on `/contact` when someone submits an inquiry:

- **Submission Type:** Next.js Server Action (`submitInquiry`) invoked over an HTTP POST.
- **Fields Sent:**
  - `fullName`: Name of the sender
  - `email`: Sender's email
  - `company` / `phone`: Company or phone number
  - `industry` / `subject`: Selected inquiry topic
  - `message`: Text message content

### What's working well:
- Next.js Server Actions keep form handling simple without needing a separate frontend state machine.
- Static assets under `/_next/static/` are cached aggressively with content hashes.

### What needs backend attention:
1. **No Rate Limiting Headers:** The server doesn't tell the client how many requests are allowed per minute. If a bot scripts 1,000 form submissions, the backend or connected mail provider has to process all of them.
2. **Missing Security Headers:** The server doesn't send standard browser defense headers like Content-Security-Policy (CSP), X-Frame-Options (clickjacking protection), or MIME-sniffing protection.
3. **Internal Route Exposure in `robots.txt`:** The crawler file explicitly lists `/admin/`, `/portal/`, and `/api/`. While this tells Googlebot not to index them, it also tells curious users where the sensitive backend paths live.
4. **Error Feedback:** Errors fallback to generic client-side messages (`"Something went wrong"`), which makes debugging production issues hard for developers because there is no unique reference ID.

---

## 4. Architecture Summary Table

| Layer | Cynbit's Current Setup | What We Can Improve |
| :--- | :--- | :--- |
| **Edge & CDN** | Vercel Edge (Mumbai `bom1`) | Keep Vercel edge, but strip server fingerprint headers. |
| **Headers** | Basic HTTPS | Add CSP, X-Frame-Options, and X-Content-Type-Options. |
| **Rate Limiting** | Edge DDoS only (Layer 3/4) | Add Layer 7 rate limiting (e.g. 5 requests/min on forms). |
| **Form Validation**| Client-side Next.js form handling | Strict schema validation with Zod on the backend. |
| **Error Handling** | Generic error messages | Structured error responses with an Incident ID. |
