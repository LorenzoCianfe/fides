/**
 * i18n scaffolding (Slice 8).
 *
 * Deliberately dependency-free. `next-intl` pulls `@swc/core`,
 * `@parcel/watcher`, and five more packages — a large surface to add
 * immediately after ADR-0026 cleared 34 advisories, for what this slice scopes
 * as *scaffolding*. Formatting rides on the platform's `Intl` (see
 * `formatMoney` in `@fides/ui-web`), which is what a library would call anyway.
 *
 * The structure — a typed catalogue per locale, one key space, a provider, and
 * a hook — is the part that matters: every user-facing string already goes
 * through it, so adopting a fuller library later is a swap, not a rewrite.
 */

export const LOCALES = ['en', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

const en = {
  'app.name': 'Fides',
  'app.tagline': 'Money, made clear.',

  'nav.dashboard': 'Accounts',
  'nav.send': 'Send',
  'nav.activity': 'Activity',
  'nav.signOut': 'Sign out',

  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.retry': 'Try again',

  'landing.intro':
    'A simulated-core EU neobank. Sign in with a passkey — there is no password to forget or leak.',
  'landing.signIn': 'Sign in',
  'landing.createAccount': 'Create an account',

  'signup.title': 'Create your account',
  'signup.email': 'Email address',
  'signup.givenName': 'First name',
  'signup.familyName': 'Last name',
  'signup.dateOfBirth': 'Date of birth',
  'signup.addressLine1': 'Address',
  'signup.city': 'City',
  'signup.postalCode': 'Postal code',
  'signup.country': 'Country code',
  'signup.countryHint': 'Two letters, e.g. IE',
  'signup.submit': 'Create account',
  'signup.haveAccount': 'Already have an account?',

  'verify.title': 'Confirm your email',
  'verify.intro': 'We sent a six-digit code to {email}. Enter it to continue.',
  'verify.code': 'Verification code',
  'verify.submit': 'Confirm email',
  'verify.resend': 'Send a new code',
  'verify.resent': 'If that address needs a code, a new one is on its way.',

  'passkey.title': 'Add a passkey',
  'passkey.intro':
    'Your passkey stays on this device and unlocks with the same gesture you use to unlock it.',
  'passkey.create': 'Create passkey',
  'passkey.unsupported':
    'This browser cannot create passkeys. Try a current Chrome, Safari, or Firefox.',
  'passkey.expired':
    'This enrolment link is no longer active. Start again and we will send a new code.',

  'signin.title': 'Sign in',
  'signin.intro': 'Enter your email and confirm with your passkey.',
  'signin.submit': 'Continue with passkey',
  'signin.noAccount': "Don't have an account?",

  'dashboard.title': 'Accounts',
  'dashboard.balance': 'Available balance',
  'dashboard.empty': 'Your account is being opened. This usually takes a moment.',
  'dashboard.send': 'Send money',
  'dashboard.activity': 'View activity',

  'send.title': 'Send money',
  'send.recipient': 'Recipient email',
  'send.amount': 'Amount',
  'send.amountHint': 'For example 25.00',
  'send.review': 'Continue',
  'send.confirmTitle': 'Confirm this payment',
  'send.confirmIntro':
    'You will be asked for your passkey. It signs these exact details — changing them afterwards invalidates the approval.',
  'send.confirmSend': 'Confirm and send',
  'send.sending': 'Sending',
  'send.success': 'Sent {amount} to {recipient}.',
  'send.again': 'Send another payment',

  'activity.title': 'Activity',
  'activity.empty': 'No transactions yet.',
  'activity.loadMore': 'Load more',

  'error.generic': 'Something went wrong. Please try again.',
  'error.network': 'Could not reach the server. Check your connection and try again.',
  'error.signInFailed': 'We could not sign you in. Check the address and try again.',
  'error.passkeyCancelled': 'Passkey confirmation was cancelled.',
  'error.amountInvalid': 'Enter an amount like 25.00.',
  'error.recipientRequired': 'Enter the recipient’s email address.',
  'error.insufficientFunds': 'You do not have enough available balance for this payment.',
  'error.recipientUnknown': 'No account matches that email address.',
  'error.selfTransfer': 'You cannot send money to yourself.',
} as const;

export type MessageKey = keyof typeof en;

const it: Record<MessageKey, string> = {
  'app.name': 'Fides',
  'app.tagline': 'Il denaro, con chiarezza.',

  'nav.dashboard': 'Conti',
  'nav.send': 'Invia',
  'nav.activity': 'Movimenti',
  'nav.signOut': 'Esci',

  'action.continue': 'Continua',
  'action.back': 'Indietro',
  'action.retry': 'Riprova',

  'landing.intro':
    'Una neobank europea a core simulato. Accedi con una passkey: nessuna password da dimenticare o da farsi rubare.',
  'landing.signIn': 'Accedi',
  'landing.createAccount': 'Crea un conto',

  'signup.title': 'Crea il tuo conto',
  'signup.email': 'Indirizzo email',
  'signup.givenName': 'Nome',
  'signup.familyName': 'Cognome',
  'signup.dateOfBirth': 'Data di nascita',
  'signup.addressLine1': 'Indirizzo',
  'signup.city': 'Città',
  'signup.postalCode': 'CAP',
  'signup.country': 'Codice paese',
  'signup.countryHint': 'Due lettere, ad esempio IT',
  'signup.submit': 'Crea conto',
  'signup.haveAccount': 'Hai già un conto?',

  'verify.title': 'Conferma la tua email',
  'verify.intro': 'Abbiamo inviato un codice di sei cifre a {email}. Inseriscilo per continuare.',
  'verify.code': 'Codice di verifica',
  'verify.submit': 'Conferma email',
  'verify.resend': 'Invia un nuovo codice',
  'verify.resent': 'Se quell’indirizzo richiede un codice, ne è in arrivo uno nuovo.',

  'passkey.title': 'Aggiungi una passkey',
  'passkey.intro':
    'La passkey resta su questo dispositivo e si sblocca con lo stesso gesto che usi per sbloccarlo.',
  'passkey.create': 'Crea passkey',
  'passkey.unsupported':
    'Questo browser non può creare passkey. Prova con una versione recente di Chrome, Safari o Firefox.',
  'passkey.expired':
    'Questa procedura di registrazione non è più attiva. Ricomincia e ti invieremo un nuovo codice.',

  'signin.title': 'Accedi',
  'signin.intro': 'Inserisci la tua email e conferma con la passkey.',
  'signin.submit': 'Continua con la passkey',
  'signin.noAccount': 'Non hai un conto?',

  'dashboard.title': 'Conti',
  'dashboard.balance': 'Saldo disponibile',
  'dashboard.empty': 'Stiamo aprendo il tuo conto. Di solito ci vuole un istante.',
  'dashboard.send': 'Invia denaro',
  'dashboard.activity': 'Vedi i movimenti',

  'send.title': 'Invia denaro',
  'send.recipient': 'Email del destinatario',
  'send.amount': 'Importo',
  'send.amountHint': 'Ad esempio 25,00',
  'send.review': 'Continua',
  'send.confirmTitle': 'Conferma questo pagamento',
  'send.confirmIntro':
    'Ti verrà chiesta la passkey. Firma esattamente questi dati: modificarli in seguito invalida l’approvazione.',
  'send.confirmSend': 'Conferma e invia',
  'send.sending': 'Invio in corso',
  'send.success': 'Inviati {amount} a {recipient}.',
  'send.again': 'Invia un altro pagamento',

  'activity.title': 'Movimenti',
  'activity.empty': 'Nessun movimento.',
  'activity.loadMore': 'Carica altri',

  'error.generic': 'Qualcosa è andato storto. Riprova.',
  'error.network': 'Server non raggiungibile. Controlla la connessione e riprova.',
  'error.signInFailed': 'Non siamo riusciti a farti accedere. Controlla l’indirizzo e riprova.',
  'error.passkeyCancelled': 'Conferma con passkey annullata.',
  'error.amountInvalid': 'Inserisci un importo come 25,00.',
  'error.recipientRequired': 'Inserisci l’indirizzo email del destinatario.',
  'error.insufficientFunds': 'Il saldo disponibile non è sufficiente per questo pagamento.',
  'error.recipientUnknown': 'Nessun conto corrisponde a quell’indirizzo email.',
  'error.selfTransfer': 'Non puoi inviare denaro a te stesso.',
};

/**
 * Catalogues are typed against the English key space, so a missing or misspelled
 * Italian key is a compile error rather than a string that silently renders as
 * its own key at runtime.
 */
export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, it };
