import { Logger } from '@nestjs/common';
import type { NotificationPort } from './notification.port';

/** Development notification adapter: writes messages to the application log. */
export class ConsoleNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger('Notifications');

  async sendEmailVerification(to: string, code: string): Promise<void> {
    this.logger.log(`Email verification for ${to}: code ${code}`);
    return Promise.resolve();
  }
}
