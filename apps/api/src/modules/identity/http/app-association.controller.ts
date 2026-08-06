import { NotFoundError } from '@fides/domain';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';

/**
 * Native passkey app association (ADR-0027).
 *
 * A platform authenticator will only release a credential scoped to the
 * relying-party id if the app proves it owns that domain, which it does by
 * fetching one of these documents over HTTPS from the RP id itself. Serving
 * them from the API means the association follows whatever origin fronts it —
 * the production domain, or a developer's HTTPS tunnel — with no separate
 * static hosting to keep in step.
 *
 * Both routes are excluded from the `/v1` prefix in `configureApp`: the paths
 * are fixed by Apple and Google and cannot be versioned.
 */
@Controller('.well-known')
export class AppAssociationController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Apple App Site Association. Passkeys need only the `webcredentials`
   * service. The path deliberately carries no `.json` extension, and the
   * document must be served as JSON — Apple rejects anything else.
   */
  @Get('apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=3600')
  appleAppSiteAssociation(): { webcredentials: { apps: string[] } } {
    const appId = this.env.IOS_APP_ID;
    // 404 rather than an empty document: an association listing no apps is a
    // silent, hard-to-diagnose passkey failure on device.
    if (!appId) throw new NotFoundError('No iOS app association configured');
    return { webcredentials: { apps: [appId] } };
  }

  /** Android Digital Asset Links, granting the app the login-credentials relation. */
  @Get('assetlinks.json')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=3600')
  assetLinks(): Array<{
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }> {
    const packageName = this.env.ANDROID_PACKAGE_NAME;
    const fingerprints = this.env.ANDROID_CERT_FINGERPRINTS;
    if (!packageName || !fingerprints?.length) {
      throw new NotFoundError('No Android app association configured');
    }
    return [
      {
        relation: ['delegate_permission/common.get_login_creds'],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ];
  }
}
