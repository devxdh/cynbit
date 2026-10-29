import { Request, Response, NextFunction } from 'express';

/**
 * Security Headers Middleware.
 * 
 * Enforces defense-in-depth baseline HTTP headers according to OWASP and RFC recommendations:
 * 
 * 1. Content-Security-Policy (CSP):
 *    - default-src 'self': Restricts script, style, image, font, and frame loading strictly to
 *      the origin, neutralizing Cross-Site Scripting (XSS) and data exfiltration vectors.
 * 
 * 2. Strict-Transport-Security (HSTS - RFC 6797):
 *    - max-age=31536000 (1 year): Enforces strict HTTPS transport.
 *    - includeSubDomains: Enforces policy across all existing and future subdomains.
 *    - preload: Qualifies the domain for inclusion in browser preloaded HSTS lists.
 * 
 * 3. X-Content-Type-Options:
 *    - nosniff: Prevents MIME-type sniffing attacks where browsers execute non-executable files
 *      (e.g., executing uploaded text/images as JavaScript).
 * 
 * 4. X-Frame-Options:
 *    - DENY: Completely forbids rendering the application inside iframe/frame/object embeds,
 *      eliminating clickjacking attacks.
 * 
 * 5. Referrer-Policy:
 *    - strict-origin-when-cross-origin: Protects query parameters and sensitive URL pathways from
 *      leaking to cross-origin third parties when following external links.
 * 
 * 6. Information Disclosure Mitigation:
 *    - Strips 'X-Powered-By' and prevents server banner leakage.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Strip technology fingerprinting headers
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Powered-By', ''); // Ensure express or reverse proxy headers are cleared

  // Restrict resource loading to origin
  res.setHeader('Content-Security-Policy', "default-src 'self'");

  // Enforce HTTPS across domain and all subdomains with preload eligibility
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  // Disable MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent UI redressing and clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Limit referrer leakage across origin boundaries
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Explicit Cross-Origin isolation guards
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  next();
}
