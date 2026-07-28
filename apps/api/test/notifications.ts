import type { NotificationPort } from '../src/shared/notifications/notification.port';

/** Captures outbound notifications so tests can read delivered codes. */
export class CapturingNotifications implements NotificationPort {
  readonly sent: { to: string; code: string }[] = [];

  async sendEmailVerification(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
    return Promise.resolve();
  }
}
