# Recommended Backend Improvements & Engineering Solutions

**Author:** Dev Dhanadiya  
**Role:** Backend Developer Intern Applicant  
**Target:** Cynbit Technologies Engineering Infrastructure

---

## What is this document?

In this document, I walk through the concrete code solutions I built to fix the issues identified in Document 2. Every solution is written in clean, readable TypeScript and Node.js (Express-compatible), with zero unnecessary complexity.

---

## 1. Strict Schema Validation with Zod

### The Problem
When you write TypeScript, interfaces like `interface ContactForm { name: string; email: string; }` only exist while writing code. Once compiled to JavaScript, Node.js receives raw JSON. If an attacker sends `{ "fullName": "Alice", "role": "admin" }`, vanilla JavaScript doesn't stop them.

### The Solution: `src/schemas/contactPayload.ts`
We use **Zod** to validate data right at the door before our business logic ever runs:

```typescript
export const contactPayloadSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(255),
    phone: z.string().trim().regex(/^\+[1-9]\d{1,14}$/).optional(),
    subject: z.union([InquirySubjectEnum, z.string().trim().min(3).max(100)]),
    message: z.string().trim().min(10).max(2000),
  })
  .strict(); // <-- Rejects any unexpected field!
```

### Why this is great:
1. **`.strict()` eliminates mass assignment:** If someone passes any extra field that isn't in our schema (like `role`, `isAdmin`, `discount`), the request is rejected immediately with HTTP 422.
2. **String length boundaries:** We set maximum lengths on everything (`message` max 2000 chars, `fullName` max 100 chars). This prevents memory bloat from someone sending a 50MB payload.
3. **E.164 Phone Format:** We ensure phone numbers follow the international standard (like `+918947962667`), so downstream SMS or CRM systems don't choke on weird formatting.

---

## 2. Token Bucket Rate Limiting

### The Problem
If a spam bot loops over our contact form endpoint, our server keeps taking requests, potentially running up email API charges or locking database connections.

### The Solution: `src/middleware/rateLimiter.ts`
We implemented an **in-memory Token Bucket** algorithm.

#### How it works in simple words:
1. Every client IP gets a "bucket" that holds up to **5 tokens**.
2. Every request takes **1 token** out of the bucket.
3. The bucket steadily refills over time (1 token every 12 seconds, or 5 tokens per minute).
4. If the bucket is empty, the server says **HTTP 429 Too Many Requests** and sets a `Retry-After: 12` header telling the client how many seconds to wait.

```
[ Request from IP 1.2.3.4 ]
          │
    Tokens left >= 1?
     ├── YES: Take 1 token -> Process Request (201 Created)
     └── NO:  Send HTTP 429 -> "Too Many Requests, retry in X seconds"
```

### In-Memory vs Redis (Interview Explanation):
- **Why in-memory for this repo?** It has zero dependencies, runs instantly on single servers, and requires no external Redis setup.
- **How would we scale it in production?** If Cynbit deploys across multiple servers or serverless lambdas, memory isn't shared between instances. To solve that, we would swap the in-memory `Map` with **Redis**:
  - Each IP gets a Redis key: `ratelimit:contact:<ip>`.
  - We run a short Redis Lua script to check and decrement tokens atomically.
  - This ensures a shared limit across all servers without race conditions.

---

## 3. Safe, Centralized Error Handling

### The Problem
If an unhandled exception happens (like a database disconnect), Express by default might send back an HTML page or a raw stack trace showing file paths and database query details. That's a security risk, and it gives clients messy, inconsistent JSON.

### The Solution: `src/middleware/errorHandler.ts`
We created a clean 4-parameter Express error handler that catches all errors in one place:

1. **If it's a Zod validation error:** We return a clean list of which fields failed with **HTTP 422 (Unprocessable Entity)** so the frontend knows exactly what to highlight to the user.
2. **If it's malformed JSON syntax:** We return **HTTP 400 (Bad Request)** explaining that the JSON was invalid.
3. **If it's an unhandled server error:**
   - We generate a unique `incidentId` (UUID).
   - We log the full stack trace to the server terminal with that `incidentId`.
   - We send the client a polite **HTTP 500 (Internal Server Error)** with just the `incidentId`, and **zero internal code details**.

```json
{
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected internal error occurred. Please quote incidentId for support.",
  "incidentId": "9a8cea5d-569d-4e41-be8f-c8e41ee68608"
}
```

Now, if a user contacts Cynbit support with an incident ID, a developer can search the server logs for that exact ID and instantly find the real error!

---

## 4. Hardening Security Headers

### The Problem
Cynbit's public website is currently missing basic headers that tell browsers how to safely load pages.

### The Solution: `src/middleware/securityHeaders.ts`
We set safe defaults on every response:
- **`Content-Security-Policy: default-src 'self'`**: Stops browsers from executing rogue third-party scripts.
- **`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`**: Forces HTTPS on all visits.
- **`X-Content-Type-Options: nosniff`**: Prevents browsers from guessing file types.
- **`X-Frame-Options: DENY`**: Blocks other sites from putting Cynbit in an iframe (clickjacking protection).
- **`app.disable('x-powered-by')`**: Hides Express branding from attackers.

---

## 5. How Everything Connects

Here is the entire flow when a request hits the server:

```
[ Incoming Request ]
        │
        ▼
1. Security Headers (Add CSP, HSTS, frame protection; hide Express)
        │
        ▼
2. Body Parser (Limit payload to 10kb to stop massive requests)
        │
        ▼
3. Rate Limiter (Allow up to 5 requests/min per IP)
        │
        ▼
4. Zod Validation (Check fields; reject extra keys with 422)
        │
        ▼
5. Route Handler (Process inquiry; return 201 Created)
        │
 (On Any Failure)
        ▼
6. Error Handler (Mask 500 errors with incidentId; format 422 field errors)
```
