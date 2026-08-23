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

function App() {
  const [open, setOpen] = useState(true);
  if (!open) return <div>closed</div>;
  return <OutreachCopilot campaign={campaign} onClose={() => setOpen(false)} aiCall={aiCall} />;
}

createRoot(document.getElementById('root')!).render(<App />);
