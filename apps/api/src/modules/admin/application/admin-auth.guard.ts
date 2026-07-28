import { AuthorizationError, InternalError } from '@fides/domain';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { extractBearerToken } from '../../identity/application/auth.guard';
import { hasPermission, type AdminPermissionName } from '../domain/permissions';
import { AdminSessionService, type AdminPrincipal } from './admin-session.service';

/** A request carrying the guard-attached back-office principal. */
export interface AdminAuthenticatedRequest extends Request {
  admin?: AdminPrincipal;
}

/**
 * Back-office authentication guard (ADR-0025). Validates the opaque admin token
 * against the `admin_sessions` row — immediate revocation, disabled admins cut
 * off, sliding idle deadline — and attaches the admin principal.
 *
 * Deliberately not `SessionAuthGuard`: a customer token resolves against a
 * different table and simply does not exist here, so the two authentication
 * surfaces cannot satisfy one another.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(AdminSessionService) private readonly sessions: AdminSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    request.admin = await this.sessions.validateToken(token);
    return true;
  }
}

export const REQUIRED_ADMIN_PERMISSION = 'fides:required-admin-permission';

/**
 * Declares the capability a route needs. The permission is checked against the
 * role → permission matrix, never against the role directly, so authorization
 * reads as "what may be done" and the matrix stays the single place policy lives.
 */
export function RequirePermission(permission: AdminPermissionName): CustomDecorator<string> {
  return SetMetadata(REQUIRED_ADMIN_PERMISSION, permission);
}

/**
 * Enforces {@link RequirePermission} against the guard-attached principal. Runs
 * after {@link AdminAuthGuard} in the `@UseGuards` list.
 *
 * Fails closed in both directions: a route wired to this guard without a
 * declared permission, or reached without an authenticated admin, is a wiring
 * fault and raises rather than quietly allowing the request through.
 */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminPermissionName | undefined>(
      REQUIRED_ADMIN_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined) {
      throw new InternalError('Admin route is missing @RequirePermission');
    }

    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const admin = request.admin;
    if (!admin) {
      throw new InternalError('Admin principal missing: AdminAuthGuard not applied to this route');
    }
    if (!hasPermission(admin.role, required)) {
      throw new AuthorizationError('This role may not perform that action', {
        required,
        role: admin.role,
      });
    }
    return true;
  }
}
