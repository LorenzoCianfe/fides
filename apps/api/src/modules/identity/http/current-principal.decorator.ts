import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { InternalError } from '@fides/domain';
import type { AuthenticatedRequest } from '../application/auth.guard';
import type { Principal } from '../application/session.service';

/**
 * Injects the guard-attached principal. Routes using it must sit behind
 * {@link SessionAuthGuard}; a missing principal is a wiring fault, not a 401.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      throw new InternalError('Principal missing: SessionAuthGuard not applied to this route');
    }
    return request.principal;
  },
);
