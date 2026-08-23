// ─── Which mailbox an email actually opens in ─────────────────────────────────
//
// Every "Compose" button in the app hard-coded ONE URL:
//
//     https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…
//
// which is Gmail, and only Gmail. That is fine for a personal account and wrong for the mailbox
// most B2B work is actually done from — a domain mailbox on Hostinger/Titan, Zoho, Rediff, a
// cPanel Roundcube, a company Microsoft 365 tenant. Pressing Compose sent those users to a Gmail
// window signed in as the wrong person, or to a Gmail they do not use at all.
//
// THE RULE HERE IS: NEVER GUESS A URL.
//
// A compose deeplink is not something that can be inferred from a provider's name — get it wrong
// and the button opens a 404, or worse, an empty compose in a mailbox that is not theirs, and the
// user finds out only after they have pressed Send. So this file carries exactly three kinds of
// entry:
//
//   1. Deeplinks that are documented and that we can state plainly (Gmail, Microsoft 365,
//      Outlook.com).
//   2. `mailto:`, which is not a guess at all — it hands the draft to whatever the machine already
//      treats as its mail app. This is the honest answer for Titan/Hostinger, Zoho, Rediff and the
//      rest: they all support being set as the default mail handler, and we do not have to know
//      anything about their URLs to use it.
//   3. WHATEVER THE USER TELLS US. If their webmail is not on the list, they give us the address of
//      it once and it is remembered. If they also know the compose-link format, they can paste that
//      and get full prefill; if they do not, we open their webmail and put the draft on the
//      clipboard, and SAY SO rather than pretending it was filled in.
//
// The presets below are for that third case: the shape of a Roundcube or Zimbra compose link is
// public knowledge, but WHICH SERVER is not — so the template is offered and the host stays the
// user's to supply. Nothing is ever applied without them seeing it, and `Test` opens a dummy draft
// so they can check with their own eyes that it prefilled before they rely on it.

export type MailProviderId =
  | 'gmail'
  | 'outlook365'
  | 'outlook_live'
  | 'mailto'
  | 'custom';

/**
 * How to send WITHOUT a human pressing Send.
 *
 * The compose links above are for a person: they open a window with the message in it and someone
 * reviews it. An automation has nobody to do that, and driving a webmail's Send button is only
 * possible where we know its DOM — which is Gmail and nothing else. SMTP is the way every other
 * mailbox can be sent from, it is what a work address is FOR, and the server answers with a plain
 * accepted-or-refused instead of something we would have to infer from the page.
 *
 * The password is NEVER stored here. This object goes to localStorage; the password goes to the OS
 * keychain through the existing credential store, under the service name `smtp`.
 */
export interface SmtpSetup {
  host: string;
  port: number;
  username: string;
  /** true = TLS from the first byte (port 465); false = STARTTLS (port 587). Providers document
   *  one or the other, and picking the wrong one is the usual reason a correct password still
   *  fails to connect — so it is a setting rather than something inferred from the port. */
  implicitTls: boolean;
  /** The name recipients see. Blank sends from the bare address. */
  fromName?: string;
  /** The address it comes FROM, when that differs from the login (aliases, shared mailboxes). */
  fromAddress?: string;
  /** Set once a Test send has really succeeded, so nothing claims this works untested. */
  verifiedAt?: number;
}

export interface MailSetup {
  provider: MailProviderId;
  /** Optional. Present = this mailbox can be sent from automatically. */
  smtp?: SmtpSetup;
  /**
   * For `custom`: the compose URL template, with {to} {subject} {body} {cc} tokens. Empty when the
   * user does not know one — then we can only open the mailbox and copy the draft.
   */
  composeTemplate?: string;
  /** For `custom`: where their webmail lives, used when there is no template to fill. */
  webmailUrl?: string;
  /** What to call it on screen ("Hostinger / Titan", "Company mail"). */
  label?: string;
  /** The address they send from. Shown so it is obvious which mailbox will open. Never sent anywhere. */
  fromAddress?: string;
}

export interface MailProviderMeta {
  id: MailProviderId;
  label: string;
  /** One line under the name in the picker. */
  hint: string;
}

export const MAIL_PROVIDERS: MailProviderMeta[] = [
  { id: 'gmail',        label: 'Gmail',                    hint: 'Personal or Google Workspace. Opens Gmail with everything filled in.' },
  { id: 'outlook365',   label: 'Outlook / Microsoft 365',  hint: 'A work or school account on outlook.office.com.' },
  { id: 'outlook_live', label: 'Outlook.com / Hotmail',    hint: 'A personal Microsoft account.' },
  { id: 'mailto',       label: 'My default mail app',      hint: 'Hands the draft to whatever this computer opens mail with — Outlook, Titan, Thunderbird, Zoho. Works with any provider once it is set as the default.' },
  { id: 'custom',       label: 'Other webmail (I\'ll give you the link)', hint: 'Hostinger/Titan, Zoho, Rediff, cPanel, a company webmail — anything. You give the address once and it is remembered.' },
];

/**
 * Ready-made compose templates for webmail software whose link format is public.
 *
 * The SERVER is deliberately left as `your-webmail-host` — that part is the user's and cannot be
 * guessed. Picking a preset fills the shape; they replace the host with theirs.
 */
export const COMPOSE_PRESETS: { label: string; template: string; note: string }[] = [
  {
    label: 'Roundcube (most cPanel / shared hosting webmail)',
    template: 'https://your-webmail-host/?_task=mail&_action=compose&_to={to}&_subject={subject}&_message={body}',
    note: 'Replace your-webmail-host with the address you normally open your webmail at.',
  },
  {
    label: 'Zimbra',
    template: 'https://your-webmail-host/zimbra/mail?view=compose&to={to}&subject={subject}&body={body}',
    note: 'Replace your-webmail-host with your Zimbra server.',
  },
  {
    label: 'I don\'t know the format — just open my webmail',
    template: '',
    note: 'We open your webmail and copy the draft so you can paste it. Nothing is filled in automatically.',
  },
];

export const MAIL_SETUP_KEY = 'nv-mail-setup';

/** Read the saved choice. Gmail stays the default, so nobody's existing behaviour changes. */
export function loadMailSetup(): MailSetup {
  try {
    const raw = localStorage.getItem(MAIL_SETUP_KEY);
    if (!raw) return { provider: 'gmail' };
    const p = JSON.parse(raw) as MailSetup;
    if (!p || typeof p !== 'object' || !p.provider) return { provider: 'gmail' };
    // An unknown id (downgrade, hand-edited storage) must not leave the app with no compose route.
    if (!MAIL_PROVIDERS.some((m) => m.id === p.provider)) return { provider: 'gmail' };
    return p;
  } catch { return { provider: 'gmail' }; }
}

export function saveMailSetup(s: MailSetup): void {
  try { localStorage.setItem(MAIL_SETUP_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export interface ComposeFields { to: string; subject?: string; body?: string; cc?: string }

export interface ComposeTarget {
  /** Where to send the user. Empty only when a custom setup has neither a template nor a URL. */
  url: string;
  /**
   * How much of the draft the destination will really have in it.
   *   full     — to, subject and body are in the link
   *   none     — we can only open the mailbox; the draft has to be pasted
   *   unset    — nothing to open; the user has not finished setting their provider up
   */
  prefill: 'full' | 'none' | 'unset';
  /** True only where we know how to drive the compose window's file input (Gmail). */
  canAttach: boolean;
  /** Whether the draft should be put on the clipboard, because the window will be empty. */
  copyDraft: boolean;
  /** One honest sentence for the UI about what is about to happen. */
  note: string;
  /** Name of the destination, for buttons and messages. */
  label: string;
}

/** Substitute {to}/{subject}/{body}/{cc} into a user-supplied template, URL-encoding each value. */
export function fillTemplate(template: string, f: ComposeFields): string {
  const enc = (v: string | undefined) => encodeURIComponent(v ?? '');
  return String(template || '')
    .replace(/\{to\}/gi, enc(f.to))
    .replace(/\{subject\}/gi, enc(f.subject))
    .replace(/\{body\}/gi, enc(f.body))
    .replace(/\{cc\}/gi, enc(f.cc));
}

/** A `mailto:` for the machine's own mail app. */
export function mailtoUrl(f: ComposeFields): string {
  const q: string[] = [];
  if (f.subject) q.push(`subject=${encodeURIComponent(f.subject)}`);
  if (f.body) q.push(`body=${encodeURIComponent(f.body)}`);
  if (f.cc) q.push(`cc=${encodeURIComponent(f.cc)}`);
  return `mailto:${encodeURIComponent(f.to || '').replace(/%40/g, '@')}${q.length ? `?${q.join('&')}` : ''}`;
}

/**
 * Work out where this email should open, and say honestly what will be in it when it does.
 *
 * Pure — no network, no storage, no window — so it can be unit-tested against every provider
 * without a browser, which is the only way to be sure a compose link is not silently malformed.
 */
export function composeTarget(setup: MailSetup, f: ComposeFields): ComposeTarget {
  const to = (f.to || '').trim();
  const su = f.subject || '';
  const body = f.body || '';

  switch (setup.provider) {
    case 'outlook365':
      return {
        url: `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
        prefill: 'full', canAttach: false, copyDraft: false, label: 'Outlook',
        note: 'Outlook opens with the message written. Attach any file with Outlook\'s own paperclip before you send.',
      };
    case 'outlook_live':
      return {
        url: `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
        prefill: 'full', canAttach: false, copyDraft: false, label: 'Outlook.com',
        note: 'Outlook.com opens with the message written. Attach any file yourself before you send.',
      };
    case 'mailto':
      return {
        url: mailtoUrl({ to, subject: su, body, cc: f.cc }),
        prefill: 'full', canAttach: false, copyDraft: false, label: 'your mail app',
        note: 'Opens in whichever mail app this computer uses, with the message written. If nothing opens, this computer has no default mail app set yet — pick a different option below.',
      };
    case 'custom': {
      const name = (setup.label || '').trim() || 'your webmail';
      const tpl = (setup.composeTemplate || '').trim();
      if (tpl) {
        return {
          url: fillTemplate(tpl, { to, subject: su, body, cc: f.cc }),
          prefill: 'full', canAttach: false, copyDraft: false, label: name,
          note: `${name} opens with the message written, using the compose link you gave. Press Test above if you have not checked it fills in properly yet.`,
        };
      }
      const web = (setup.webmailUrl || '').trim();
      if (web) {
        return {
          url: web,
          // Deliberately NOT claiming a prefill we cannot do. The draft goes on the clipboard and
          // the UI says to paste it — a wrong claim here means a blank email getting sent.
          prefill: 'none', canAttach: false, copyDraft: true, label: name,
          note: `${name} opens at your inbox and the draft is copied to your clipboard — start a new message, paste it, and put ${to || 'their address'} in the To field. I can't fill it in for you because there is no compose link saved for this provider.`,
        };
      }
      return {
        url: '', prefill: 'unset', canAttach: false, copyDraft: false, label: name,
        note: 'Tell me where your webmail is first — press "Set up" and paste the address you open your mail at.',
      };
    }
    case 'gmail':
    default:
      return {
        url: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`,
        prefill: 'full', canAttach: true, copyDraft: false, label: 'Gmail',
        note: 'Gmail opens with the message written, and a file can be attached for you.',
      };
  }
}

/** Human name of the configured destination, for buttons ("Open in Gmail" / "Open in Outlook"). */
export function mailDestinationName(setup: MailSetup): string {
  if (setup.provider === 'custom') return (setup.label || '').trim() || 'your webmail';
  return MAIL_PROVIDERS.find((m) => m.id === setup.provider)?.label ?? 'Gmail';
}

/** Is this setup usable, or is the user one step from a dead button? */
export function mailSetupIncomplete(setup: MailSetup): boolean {
  return setup.provider === 'custom'
    && !(setup.composeTemplate || '').trim()
    && !(setup.webmailUrl || '').trim();
}

// ─── Sending on the user's behalf ─────────────────────────────────────────────

/**
 * Common SMTP settings, per provider.
 *
 * Unlike a compose deeplink, these ARE published by the providers themselves and are stable, so
 * offering them saves the user a support-page hunt. They are still only a STARTING POINT: every
 * field stays editable, nothing is used until a Test send actually succeeds, and a provider that
 * is not on this list is typed in by hand rather than guessed at.
 */
export const SMTP_PRESETS: { id: string; label: string; host: string; port: number; implicitTls: boolean; note: string }[] = [
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, implicitTls: true,
    note: 'Needs an App Password (Google account → Security → 2-Step Verification → App passwords), not your normal password.' },
  { id: 'titan', label: 'Titan / Hostinger email', host: 'smtp.titan.email', port: 465, implicitTls: true,
    note: 'Your full email address and its password. Turn on third-party email access in Titan first. Port 587 with STARTTLS is the alternative if 465 is blocked.' },
  { id: 'hostinger', label: 'Hostinger (non-Titan mailbox)', host: 'smtp.hostinger.com', port: 465, implicitTls: true,
    note: 'Use the mailbox address and password from hPanel → Emails.' },
  { id: 'zoho_in', label: 'Zoho Mail (India — .in)', host: 'smtp.zoho.in', port: 465, implicitTls: true,
    note: 'Zoho needs an app-specific password when 2FA is on. Use smtp.zoho.com instead if your account is on the global data centre.' },
  { id: 'zoho_com', label: 'Zoho Mail (global — .com)', host: 'smtp.zoho.com', port: 465, implicitTls: true,
    note: 'Zoho needs an app-specific password when 2FA is on.' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp-mail.outlook.com', port: 587, implicitTls: false,
    note: 'STARTTLS on 587. Many tenants now require an app password or block basic SMTP entirely — if Test fails, your admin has turned SMTP AUTH off.' },
  { id: 'custom', label: 'Something else — I will type it in', host: '', port: 465, implicitTls: true,
    note: 'Your provider calls this "outgoing mail server" or "SMTP". Port 465 usually means SSL/TLS; 587 usually means STARTTLS.' },
];

/** Keychain service name for the SMTP password. Never localStorage. */
export const SMTP_CREDENTIAL_SERVICE = 'smtp';

/**
 * Can this mailbox send on its own, right now?
 *
 * Requires a host, a username AND a successful Test. The last one is the point: a configuration
 * that has never connected is a configuration that will fail in the middle of a run of forty, at
 * which time nobody is watching.
 */
export function canAutoSendEmail(setup: MailSetup): boolean {
  const s = setup.smtp;
  return !!(s && s.host.trim() && s.username.trim() && s.verifiedAt);
}

/** Why it cannot, in words the UI can show. */
export function autoSendBlocker(setup: MailSetup): string {
  const s = setup.smtp;
  if (!s || !s.host.trim() || !s.username.trim()) {
    return 'Automatic sending needs your mailbox\'s outgoing (SMTP) details. Add them under "Send from", then press Test.';
  }
  if (!s.verifiedAt) {
    return 'These SMTP details have not connected successfully yet. Press Test — a run must never start on settings that have never worked.';
  }
  return '';
}

/** The address an automated send will really come from. */
export function sendingAddress(setup: MailSetup): string {
  const s = setup.smtp;
  if (!s) return '';
  return (s.fromAddress || '').trim() || (s.username || '').trim();
}
