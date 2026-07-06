import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A minimal software P-256 authenticator producing genuine WebAuthn payloads —
 * real CBOR attestation objects and real ECDSA assertion signatures — so the
 * relying-party verification runs end to end in tests. UV, counter, origin,
 * and RP ID are all overridable to exercise the failure paths.
 */

const AAGUID = new Uint8Array(16); // Zeroed, as typical for attestation "none".

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

function sha256(input: Uint8Array | string): Buffer {
  return createHash('sha256').update(input).digest();
}

function b64url(input: Uint8Array): string {
  return Buffer.from(input).toString('base64url');
}

function encodeCbor(value: unknown): Uint8Array {
  return isoCBOR.encode(value as Parameters<typeof isoCBOR.encode>[0]);
}

export interface RegistrationCeremonyInput {
  readonly challenge: string;
  readonly rpId: string;
  readonly origin: string;
  readonly userVerified?: boolean;
}

export interface AuthenticationCeremonyInput extends RegistrationCeremonyInput {
  /** Explicit signature counter; defaults to auto-increment. */
  readonly counter?: number;
}

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32);
  counter = 0;
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  get credentialIdB64(): string {
    return b64url(this.credentialId);
  }

  createRegistrationResponse(input: RegistrationCeremonyInput): RegistrationResponseJSON {
    const { challenge, rpId, origin, userVerified = true } = input;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
    );
    const flags = FLAG_UP | FLAG_AT | (userVerified ? FLAG_UV : 0);
    const authData = this.buildAuthData(rpId, flags, this.counter, true);
    const attestationObject = encodeCbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  createAuthenticationResponse(input: AuthenticationCeremonyInput): AuthenticationResponseJSON {
    const { challenge, rpId, origin, userVerified = true } = input;
    const counter = input.counter ?? ++this.counter;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    );
    const flags = FLAG_UP | (userVerified ? FLAG_UV : 0);
    const authData = this.buildAuthData(rpId, flags, counter, false);
    // WebAuthn assertion signature: ECDSA over authenticatorData ‖ SHA-256(clientDataJSON).
    const signature = createSign('sha256')
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign(this.keys.privateKey);

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
    };
  }

  /** COSE_Key (EC2 / ES256 / P-256) for the attested credential data. */
  private cosePublicKey(): Uint8Array {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    if (!jwk.x || !jwk.y) throw new Error('Unexpected JWK shape for a P-256 key');
    return encodeCbor(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
  }

  private buildAuthData(
    rpId: string,
    flags: number,
    counter: number,
    includeCredential: boolean,
  ): Buffer {
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(counter);
    const parts: Uint8Array[] = [sha256(rpId), Buffer.from([flags]), counterBytes];
    if (includeCredential) {
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(this.credentialId.length);
      parts.push(AAGUID, credentialIdLength, this.credentialId, this.cosePublicKey());
    }
    return Buffer.concat(parts);
  }
}
