import { AuthenticationError, type EventClock } from '@fides/domain';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  FinishPasskeyRegistrationResponseDto,
  RegisterResponseDto,
  SessionResponseDto,
  VerifyEmailResponseDto,
  WebAuthnCreationOptionsDto,
  WebAuthnRequestOptionsDto,
} from '@fides/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { ENV, type Env } from '../../../config/env';
import { CLOCK } from '../../../shared/tokens';
import { extractBearerToken } from '../application/auth.guard';
import { EmailVerificationService } from '../application/email-verification.service';
import { RegistrationService } from '../application/registration.service';
import { SessionService, type IssuedSession } from '../application/session.service';
import { WebAuthnService } from '../application/webauthn.service';
import {
  generateCsrfToken,
  hashCsrfToken,
  readCsrfHeader,
  readRefreshCookie,
  resolveTokenTransport,
  setSessionCookies,
  type CookieTransportConfig,
} from './token-transport';
import {
  FinishAuthenticationDto,
  FinishPasskeyRegistrationDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  StartAuthenticationDto,
  StartPasskeyRegistrationDto,
  VerifyEmailDto,
} from './dtos';
import { toSessionDto } from './mappers';

/**
 * Public authentication surface (ADR-0021): onboarding, WebAuthn ceremonies,
 * and session bootstrap. Every route is IP-throttled; the tightest limits sit
 * on the endpoints that send email or write accounts.
 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(RegistrationService) private readonly registration: RegistrationService,
    @Inject(EmailVerificationService) private readonly emailVerification: EmailVerificationService,
    @Inject(WebAuthnService) private readonly webauthn: WebAuthnService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: EventClock,
  ) {}

  private get cookieConfig(): CookieTransportConfig {
    return { secure: this.env.COOKIE_SECURE, sameSite: this.env.COOKIE_SAMESITE };
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(
    @Body(new ZodValidationPipe(RegisterDto)) body: RegisterDto,
  ): Promise<RegisterResponseDto> {
    return this.registration.register(body);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailDto)) body: VerifyEmailDto,
  ): Promise<VerifyEmailResponseDto> {
    return this.emailVerification.verifyEmail(body.email, body.code);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationDto)) body: ResendVerificationDto,
  ): Promise<void> {
    await this.emailVerification.resendVerification(body.email);
  }

  @Post('webauthn/registration/options')
  @HttpCode(HttpStatus.OK)
  async startPasskeyRegistration(
    @Body(new ZodValidationPipe(StartPasskeyRegistrationDto)) body: StartPasskeyRegistrationDto,
    @Req() request: Request,
  ): Promise<WebAuthnCreationOptionsDto> {
    const authenticatedUserId = await this.resolveOptionalUserId(request);
    return this.webauthn.startRegistration({
      userId: body.userId,
      enrolmentToken: body.enrolmentToken,
      authenticatedUserId,
    });
  }

  @Post('webauthn/registration/verify')
  async finishPasskeyRegistration(
    @Body(new ZodValidationPipe(FinishPasskeyRegistrationDto)) body: FinishPasskeyRegistrationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FinishPasskeyRegistrationResponseDto> {
    const authenticatedUserId = await this.resolveOptionalUserId(request);
    const result = await this.webauthn.finishRegistration({
      userId: body.userId,
      enrolmentToken: body.enrolmentToken,
      authenticatedUserId,
      response: body.response as RegistrationResponseJSON,
      device: body.device,
    });
    return {
      credentialId: result.credentialId,
      session: result.session ? await this.deliverSession(request, response, result.session) : null,
    };
  }

  @Post('webauthn/authentication/options')
  @HttpCode(HttpStatus.OK)
  startAuthentication(
    @Body(new ZodValidationPipe(StartAuthenticationDto)) body: StartAuthenticationDto,
  ): Promise<WebAuthnRequestOptionsDto> {
    return this.webauthn.startAuthentication(body.email);
  }

  @Post('webauthn/authentication/verify')
  @HttpCode(HttpStatus.OK)
  async finishAuthentication(
    @Body(new ZodValidationPipe(FinishAuthenticationDto)) body: FinishAuthenticationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponseDto> {
    const session = await this.webauthn.finishAuthentication({
      response: body.response as AuthenticationResponseJSON,
      device: body.device,
    });
    return this.deliverSession(request, response, session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(RefreshDto)) body: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponseDto> {
    // In cookie transport the client cannot read the httpOnly refresh cookie,
    // so the token is taken from the cookie the browser sends automatically.
    // A body-supplied token is not ambient and needs no CSRF proof; a cookie
    // one does, and the service checks it against the locked session row.
    const cookieToken = body.refreshToken ? undefined : readRefreshCookie(request);
    const refreshToken = body.refreshToken ?? cookieToken;
    if (!refreshToken) throw new AuthenticationError('Missing refresh token');

    const session = await this.sessions.refresh(
      refreshToken,
      correlationId,
      cookieToken ? { value: readCsrfHeader(request) } : undefined,
    );
    return this.deliverSession(request, response, session);
  }

  /**
   * Hand the session back over the transport the caller asked for (ADR-0027).
   *
   * Body transport is the default and is untouched. Cookie transport writes the
   * token pair to httpOnly cookies, mints a CSRF token bound to the session,
   * and strips both tokens from the payload — a client in cookie mode must not
   * be able to read them at all, or the mode buys nothing.
   */
  private async deliverSession(
    request: Request,
    response: Response,
    session: IssuedSession,
  ): Promise<SessionResponseDto> {
    if (resolveTokenTransport(request) !== 'cookie') return toSessionDto(session);

    const csrfToken = generateCsrfToken();
    await this.sessions.attachCsrfToken(session.sessionId, hashCsrfToken(csrfToken));
    setSessionCookies(response, session, csrfToken, this.cookieConfig, this.clock.now());
    return toSessionDto(session, false);
  }

  /**
   * Optional principal for the passkey-registration routes: the first passkey
   * arrives unauthenticated (enrolment token), additional ones with a bearer.
   * A presented-but-invalid bearer is rejected, never silently ignored.
   */
  private async resolveOptionalUserId(request: Request): Promise<string | undefined> {
    if (!request.headers.authorization) return undefined;
    const token = extractBearerToken(request.headers.authorization);
    const principal = await this.sessions.validateAccessToken(token);
    return principal.userId;
  }
}
