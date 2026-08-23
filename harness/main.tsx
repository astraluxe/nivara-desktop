import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import OutreachCopilot from '../src/components/krew/OutreachCopilot';
import type { OutreachCampaign } from '../src/components/krew/OutreachCopilot';

// A fake model: deterministic, instant, and it records every prompt it was handed so the test can
// assert WHAT was asked, not just that something happened.
const aiCall = async (user: string, _system: string) => {
  (window as any).__ai = [...((window as any).__ai || []), user];
  const who = /PERSON:\s*(.+)/.exec(user)?.[1]?.trim() || 'there';
  await new Promise((r) => setTimeout(r, 5));
  if ((window as any).__aiFail) throw new Error('model exploded');
  if ((window as any).__aiEmpty) return '';
  return `Subject: NEW SUBJECT for ${who}\n\nNEW BODY for ${who}. Rewritten.`;
};

// A body long enough to pass the "is this a real message" floor, so the send tests exercise the
// send logic rather than the length guard.
const REAL = (who: string) =>
  `Hi ${who}, I saw your team is scaling operations this quarter and thought this was worth a short note. We build the tooling that usually gets hired for. Worth fifteen minutes next week?`;

const campaign: OutreachCampaign = {
  title: 'Harness campaign',
  channel: 'both',
  contacts: [
    { name: 'Priya Sharma',  company: 'Acme',  email: 'priya@acme.co.in',  status: 'todo',    email_subject: 'S0', email_body: 'B0' },
    { name: 'Rahul Verma',   company: 'Beta',  email: 'rahul@beta.in',     status: 'todo',    email_subject: 'S1', email_body: 'B1' },
    { name: 'Sent Person',   company: 'Gamma', email: 'sent@gamma.in',     status: 'sent',    email_subject: 'S2', email_body: 'B2' },
    { name: 'Replied Person',company: 'Delta', email: 'rep@delta.in',      status: 'replied', email_subject: 'S3', email_body: 'B3' },
    { name: 'No Draft',      company: 'Eps',   email: 'nd@eps.in',         status: 'todo' },
  ],
};

// A second campaign whose drafts are actually sendable — used by the auto-send tests.
const sendable: OutreachCampaign = {
  title: 'Sendable campaign',
  channel: 'both',
  contacts: [
    { name: 'Aisha Khan',   company: 'Acme',  email: 'aisha@acme.co.in', status: 'todo', email_subject: 'Ops tooling for Acme',  email_body: REAL('Aisha') },
    { name: 'Rohit Nair',   company: 'Beta',  email: 'rohit@beta.in',    status: 'todo', email_subject: 'Ops tooling for Beta',  email_body: REAL('Rohit') },
    { name: 'Meera Iyer',   company: 'Gamma', email: 'meera@gamma.in',   status: 'todo', email_subject: 'Ops tooling for Gamma', email_body: REAL('Meera') },
    { name: 'Placeholder Person', company: 'Delta', email: 'ph@delta.in', status: 'todo', email_subject: 'Hi [Name]', email_body: REAL('there') },
    { name: 'Already Sent', company: 'Eps',   email: 'as@eps.in',        status: 'sent', email_subject: 'Ops tooling', email_body: REAL('Sent') },
  ],
};

function App() {
  const [open, setOpen] = useState(true);
  // ?campaign=sendable mounts the roster whose drafts really are sendable.
  const which = new URLSearchParams(location.search).get('campaign') === 'sendable' ? sendable : campaign;
  if (!open) return <div>closed</div>;
  return <OutreachCopilot campaign={which} onClose={() => setOpen(false)} aiCall={aiCall} />;
}

createRoot(document.getElementById('root')!).render(<App />);
