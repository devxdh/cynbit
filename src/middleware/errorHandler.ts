import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { randomUUID } from 'crypto';

export interface InvalidParamDetail {
  field: string;
  message: string;
  code: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  incidentId?: string;
  invalidParams?: InvalidParamDetail[];
  timestamp: string;
}

/**
 * Production-Grade 4-Parameter Express Error Handling Middleware.
 * 
 * Implements RFC 7807 (Problem Details for HTTP APIs):
 * - Guarantees deterministic, structured error envelopes across all failure modes.
 * - Isolates internal implementation details (stack traces, SQL errors, system paths) from clients.
 * - Correlates server-side diagnostic logs with client-visible `incidentId` tokens.
 * 
 * Failure Domains Handled:
 * 1. ZodError (422 Unprocessable Entity):
 *    - Schema constraint violations, missing mandatory fields, unrecognized keys from .strict().
 * 2. SyntaxError (400 Bad Request):
 *    - Malformed JSON payloads intercepted before reaching route controllers.
 * 3. Generic/Unhandled Exceptions (500 Internal Server Error):
 *    - Unforeseen system failures masked behind a safe client message while logging full context.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const instance = req.originalUrl || req.url;

  // Case 1: Schema Validation Errors (Zod)
  if (err instanceof ZodError) {
    const invalidParams: InvalidParamDetail[] = err.errors.map((issue) => ({
      field: issue.path.join('.') || 'payload',
      message: issue.message,
      code: issue.code,
    }));

    const problem: ProblemDetails = {
      type: 'https://tools.ietf.org/html/rfc4918#section-11.2',
      title: 'Unprocessable Entity',
      status: 422,
      detail: `Validation failed on ${invalidParams.length} parameter(s).`,
      instance,
      invalidParams,
      timestamp,
    };

    res.status(422).contentType('application/problem+json').json(problem);
    return;
  }

  // Case 2: Malformed JSON Syntax in Request Body
  if (err instanceof SyntaxError && 'status' in err && (err as { status: unknown }).status === 400 && 'body' in err) {
    const problem: ProblemDetails = {
      type: 'https://tools.ietf.org/html/rfc7231#section-6.5.1',
      title: 'Bad Request',
      status: 400,
      detail: 'The request body contained invalid or malformed JSON syntax.',
      instance,
      timestamp,
    };

    res.status(400).contentType('application/problem+json').json(problem);
    return;
  }

  // Case 3: Generic / Unhandled Internal Exceptions
  const incidentId = randomUUID();

  // Secure Server-Side Logging: Retain diagnostics for observability without exposing to clients
  console.error(`[INCIDENT-ID: ${incidentId}] Unhandled Server Exception:`, {
    timestamp,
    method: req.method,
    url: instance,
    clientIp: req.ip,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });

  const problem: ProblemDetails = {
    type: 'https://tools.ietf.org/html/rfc7231#section-6.6.1',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected internal error occurred while processing your request. Please reference the incidentId for inquiries.',
    instance,
    incidentId,
    timestamp,
  };

  res.status(500).contentType('application/problem+json').json(problem);
}
