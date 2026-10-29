import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { securityHeaders } from './middleware/securityHeaders';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { contactPayloadSchema, ContactPayload } from './schemas/contactPayload';

export const app = express();

// 1. Disable server fingerprinting in Express framework
app.disable('x-powered-by');

// 2. Global Security Headers Baseline
app.use(securityHeaders);

// 3. Strict Payload Body Parsing (bounded to 10kb to prevent memory exhaustion attacks)
app.use(express.json({ limit: '10kb' }));

// 4. Health Check Route (Observability & Uptime Probes)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Public Contact / Inquiry Ingestion Endpoint
 * 
 * Pipeline:
 * [Client Request] 
 *   -> [Security Headers]
 *   -> [Body Parser (10kb max)]
 *   -> [Token Bucket Rate Limiter (5 req / 60s)]
 *   -> [Zod Strict Schema Validation]
 *   -> [Business Processing / Queue]
 *   -> [Deterministic 201 Response]
 */
app.post('/api/inquiry', rateLimiter, (req: Request, res: Response, next) => {
  try {
    // Strict schema parse: Throws ZodError on violation, caught by centralized errorHandler
    const validatedData: ContactPayload = contactPayloadSchema.parse(req.body);

    const inquiryId = randomUUID();
    const receivedAt = new Date().toISOString();

    // In a full production workflow, this would be dispatched to an asynchronous worker
    // or message broker (e.g., BullMQ, AWS SQS, RabbitMQ) to avoid blocking the event loop:
    // await inquiryQueue.add('send-notification', { inquiryId, ...validatedData });

    res.status(201).json({
      success: true,
      message: 'Inquiry successfully received and scheduled for architectural review.',
      inquiryId,
      receivedAt,
      data: {
        fullName: validatedData.fullName,
        email: validatedData.email,
        subject: validatedData.subject,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Explicit endpoint to demonstrate production error masking (unhandled error -> 500 RFC 7807)
app.get('/api/simulate-fault', (_req: Request, _res: Response, next) => {
  try {
    throw new Error('Simulated database connection failure: connection timeout at 10.0.4.12:5432');
  } catch (err) {
    next(err);
  }
});

// 404 Route Handler for undefined endpoints
app.use((req: Request, res: Response) => {
  res.status(404).contentType('application/problem+json').json({
    type: 'https://tools.ietf.org/html/rfc7231#section-6.5.4',
    title: 'Not Found',
    status: 404,
    detail: `The requested endpoint '${req.originalUrl}' does not exist on this server.`,
    instance: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
});

// 5. Centralized Error Handling Pipeline (Must be last middleware)
app.use(errorHandler);

// Start server when executed directly
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Cynbit Remediation Service] Active and listening on port ${PORT}`);
    console.log(`[Architecture] Security headers: ACTIVE | Token bucket rate limit: 5/60s | Zod validation: STRICT`);
  });
}
