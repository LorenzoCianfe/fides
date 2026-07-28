import { InternalError } from '@fides/domain';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminAuthenticatedRequest } from '../application/admin-auth.guard';
import type { AdminPrincipal } from '../application/admin-session.service';

/**
 * Injects the guard-attached back-office principal. Routes using it must sit
 * behind {@link AdminAuthGuard}; a missing principal is a wiring fault, not a 401.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    if (!request.admin) {
      throw new InternalError('Admin principal missing: AdminAuthGuard not applied to this route');
    }
    return request.admin;
  },
);
