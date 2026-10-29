import { z } from 'zod';

/**
 * Standard inquiry subjects recognized by Cynbit business operations.
 */
export const InquirySubjectEnum = z.enum([
  'GENERAL_INQUIRY',
  'TECHNICAL_CONSULTING',
  'AI_AUTOMATION',
  'CUSTOM_SOFTWARE',
  'ENTERPRISE_SOLUTIONS',
  'CAREERS',
]);

export type InquirySubject = z.infer<typeof InquirySubjectEnum>;

/**
 * E.164 international phone number format:
 * - Starts with a '+'
 * - Followed by 1 to 15 digits (country code + subscriber number)
 * - First digit after '+' cannot be 0 (ITU-T recommendation E.164)
 */
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Contact/Inquiry payload schema for Cynbit's public ingestion endpoints.
 * 
 * Defense-in-depth principles:
 * 1. .strict(): Rejects unknown/extraneous keys immediately to prevent mass assignment,
 *    prototype pollution attempts, and unintended downstream schema propagation.
 * 2. Min/Max bounds: Bounds all string lengths to protect against algorithmic complexity
 *    and database buffer exhaustion.
 * 3. Sanitization/Trimming: Trims whitespace automatically before validation.
 */
export const contactPayloadSchema = z
  .object({
    fullName: z
      .string({ required_error: 'fullName is required' })
      .trim()
      .min(2, { message: 'fullName must contain at least 2 characters' })
      .max(100, { message: 'fullName must not exceed 100 characters' }),

    email: z
      .string({ required_error: 'email is required' })
      .trim()
      .toLowerCase()
      .email({ message: 'email must be a valid RFC 5322 email address' })
      .max(255, { message: 'email must not exceed 255 characters' }),

    phone: z
      .string()
      .trim()
      .regex(E164_PHONE_REGEX, {
        message: 'phone must follow the international E.164 format (e.g., +918947962667)',
      })
      .optional(),

    subject: z
      .union([
        InquirySubjectEnum,
        z
          .string()
          .trim()
          .min(3, { message: 'subject must contain at least 3 characters' })
          .max(100, { message: 'subject must not exceed 100 characters' }),
      ], {
        required_error: 'subject is required',
        invalid_type_error: 'subject must be an inquiry category enum or a bounded string (3-100 characters)',
      }),

    message: z
      .string({ required_error: 'message is required' })
      .trim()
      .min(10, { message: 'message must contain at least 10 characters' })
      .max(2000, { message: 'message must not exceed 2000 characters' }),
  })
  .strict();

export type ContactPayload = z.infer<typeof contactPayloadSchema>;
