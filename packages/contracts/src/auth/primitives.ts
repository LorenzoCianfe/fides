import { z } from '../zod';

/** Account identifier; normalized (trimmed, lower-cased) at the boundary. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254)
  .openapi({ example: 'alice@example.com' });

/**
 * Client-declared device metadata attached to session issuance. Honest but
 * untrusted until mobile attestation strengthens it (ADR-0020).
 */
export const DeviceDescriptorSchema = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: 'Chrome on Windows' }),
    platform: z.enum(['web', 'ios', 'android']),
  })
  .openapi('DeviceDescriptor');

export type DeviceDescriptorDto = z.infer<typeof DeviceDescriptorSchema>;
