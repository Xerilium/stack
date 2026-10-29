import { DEFAULT_RULES, prefilter, type RulesConfig } from '../../src/email/rules';
import { msg } from './fixtures';

const cfg: RulesConfig = {
  ...DEFAULT_RULES,
  owner: ['me@example.test'],
  vip: ['boss@example.test', 'vip.example.test'],
  sensitive: ['pay.example.test', 'counsel@example.test'],
};
const run = (m: Parameters<typeof msg>[0]) => prefilter(msg(m), cfg);
const cls = (m: Parameters<typeof msg>[0]) => run(m)?.class;
const bulk = { 'List-Unsubscribe': '<mailto:u@example.test>' };

// @req FR:email-triage/rules.order
describe('prefilter order', () => {
  it('skips when the owner already answered, whatever else matches', () => {
    expect(cls({ threadLastFrom: 'ME@example.test' })).toBe('skip');
    expect(cls({ from: { address: 'me@example.test' } })).toBe('skip');
    expect(cls({ threadLastFrom: 'me@example.test', headers: bulk, odataType: '#microsoft.graph.eventMessage' })).toBe('skip');
    expect(cls({ threadLastFrom: 'alex@example.test' })).toBeUndefined();
  });

  it('calendar items beat sensitive, bulk and receipt', () => {
    expect(cls({ odataType: '#microsoft.graph.eventMessage', headers: bulk })).toBe('calendar');
    expect(cls({ odataType: '#microsoft.graph.eventMessageRequest', from: { address: 'x@pay.example.test' } })).toBe('calendar');
  });

  it('sensitive senders (exact address, domain, subdomain) beat bulk and receipt and are never modeled', () => {
    expect(cls({ from: { address: 'counsel@example.test' } })).toBe('sensitive');
    expect(cls({ from: { address: 'a@pay.example.test' }, headers: bulk })).toBe('sensitive');
    expect(cls({ from: { address: 'a@eu.pay.example.test' }, subject: 'Your receipt' })).toBe('sensitive');
    expect(cls({ from: { address: 'a@notpay.example.test' } })).toBeUndefined();
  });

  it('default sensitive patterns catch bank, payroll, legal and medical senders', () => {
    for (const a of ['hr@example.test', 'no-reply@bank.example.test', 'x@payroll.example.test', 'legal@example.test', 'a@clinic.example.test']) expect(cls({ from: { address: a } })).toBe('sensitive');
    expect(cls({ from: { address: 'lawrence@example.test' } })).toBeUndefined();
  });

  it('bulk headers settle as newsletter', () => {
    expect(cls({ headers: bulk })).toBe('newsletter');
    expect(cls({ headers: { 'list-id': '<l.example.test>' } })).toBe('newsletter');
    expect(cls({ headers: { Precedence: 'bulk' } })).toBe('newsletter');
    expect(cls({ headers: { precedence: 'List' } })).toBe('newsletter');
    expect(cls({ headers: { 'Auto-Submitted': 'auto-generated' } })).toBe('newsletter');
    expect(cls({ headers: { 'Auto-Submitted': 'no' } })).toBeUndefined();
    expect(cls({ headers: { Precedence: 'first-class' } })).toBeUndefined();
  });

  it('receipts and notifications by sender or subject need no question in the preview', () => {
    expect(cls({ subject: 'Your receipt from Shop #123', bodyPreview: 'Thanks for your order.' })).toBe('receipt');
    expect(cls({ subject: 'Invoice 42', bodyPreview: 'Amount due: 10.00' })).toBe('receipt');
    expect(cls({ subject: 'Security alert', bodyPreview: 'New sign-in.' })).toBe('receipt');
    expect(cls({ from: { address: 'noreply@shop.example.test' }, subject: 'Hello', bodyPreview: 'Hi there.' })).toBe('receipt');
    expect(cls({ subject: 'Your receipt', bodyPreview: 'Was the amount correct?' })).toBeUndefined();
    expect(cls({ from: { address: 'noreply@shop.example.test' }, bodyPreview: 'Can you confirm?' })).toBeUndefined();
  });

  it('bulk wins over receipt; everything else is null (needs a model)', () => {
    expect(cls({ headers: bulk, subject: 'Your receipt' })).toBe('newsletter');
    expect(run({})).toBeNull();
  });
});

// @req FR:email-triage/rules.vip
describe('prefilter vip', () => {
  it('never settles a VIP by rules except skip and calendar; result carries vip', () => {
    expect(run({ from: { address: 'boss@example.test' }, headers: bulk })).toEqual({ class: null, vip: true, rule: 'vip' });
    expect(run({ from: { address: 'Boss@Example.test' }, subject: 'Your receipt', bodyPreview: 'ok' })).toMatchObject({ class: null, vip: true });
    expect(run({ from: { address: 'cfo@vip.example.test' }, headers: bulk })).toMatchObject({ class: null, vip: true });
    expect(run({ from: { address: 'boss@example.test' }, threadLastFrom: 'me@example.test' })).toMatchObject({ class: 'skip', vip: true });
    expect(run({ from: { address: 'boss@example.test' }, odataType: '#microsoft.graph.eventMessage' })).toMatchObject({ class: 'calendar', vip: true });
  });

  it('a plain VIP message is passed on with vip set; non-VIPs carry no flag', () => {
    expect(run({ from: { address: 'boss@example.test' } })).toMatchObject({ class: null, vip: true });
    expect(run({ headers: bulk })?.vip).toBeUndefined();
  });

  it('sensitive still stays off the model even for a VIP', () => {
    expect(cls({ from: { address: 'counsel@example.test' } })).toBe('sensitive');
    const c: RulesConfig = { ...cfg, vip: ['counsel@example.test'] };
    expect(prefilter(msg({ from: { address: 'counsel@example.test' } }), c)?.class).toBe('sensitive');
  });
});

// @req FR:email-triage/rules.order
describe('rules are data', () => {
  it('survive a JSON round trip and change behaviour when edited', () => {
    const c = JSON.parse(JSON.stringify(cfg)) as RulesConfig;
    expect(prefilter(msg({ subject: 'Delivery update' }), c)).toBeNull();
    c.receiptSubjectPatterns = [...c.receiptSubjectPatterns, 'delivery update'];
    expect(prefilter(msg({ subject: 'Delivery update', bodyPreview: 'Arrives today.' }), c)?.class).toBe('receipt');
  });
});
