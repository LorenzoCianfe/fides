import { z } from '../zod';

/** An issued session: opaque tokens plus their deadlines (ADR-0020). */
export const SessionResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    userId: z.string().uuid(),
    deviceId: z.string().uuid(),
    accessToken: z
      .string()
      .optional()
      .openapi({
        description:
          'Opaque bearer access token (fat_…). Present in body transport only; omitted when the ' +
          'caller requested cookie transport, where it is set as an httpOnly cookie instead ' +
          '(ADR-0027).',
      }),
    refreshToken: z
      .string()
      .optional()
      .openapi({
        description:
          'Opaque rotating refresh token (frt_…). Present in body transport only; omitted when the ' +
          'caller requested cookie transport (ADR-0027).',
      }),
    accessTokenExpiresAt: z.string().datetime(),
    refreshExpiresAt: z.string().datetime(),
    absoluteExpiresAt: z.string().datetime(),
  })
  .openapi('Session');

export type SessionResponseDto = z.infer<typeof SessionResponseSchema>;

export const RefreshRequestSchema = z
  .object({
    refreshToken: z
      .string()
      .min(1)
      .optional()
      .openapi({
        description:
          'Omit in cookie transport: the refresh token is read from the httpOnly cookie scoped to ' +
          'this route (ADR-0027). Required in body transport.',
      }),
  })
  .openapi('RefreshRequest');

export type RefreshRequestDto = z.infer<typeof RefreshRequestSchema>;

/** One entry of the caller's active-session list; token material never appears. */
export const SessionSummarySchema = z
  .object({
    sessionId: z.string().uuid(),
    device: z.object({
      id: z.string().uuid(),
      name: z.string(),
      platform: z.string(),
    }),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime(),
    /** True for the session making the request. */
    current: z.boolean(),
  })
  .openapi('SessionSummary');

export type SessionSummaryDto = z.infer<typeof SessionSummarySchema>;

export const SessionListResponseSchema = z
  .object({ sessions: z.array(SessionSummarySchema) })
  .openapi('SessionList');

export type SessionListResponseDto = z.infer<typeof SessionListResponseSchema>;
