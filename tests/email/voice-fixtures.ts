import type { SentMessage } from '../../src/email/voice';

/** Synthetic sent mail for an owner who writes short, plain, contraction-heavy replies and signs "Thanks,\nSam". Every address is on example.test. */
const base = { to: [{ name: 'Alex Rivera', address: 'alex@partner.example.test' }] };
let n = 0;
export const sent = (body: string, over: Partial<SentMessage> = {}): SentMessage => ({
  id: `S-${++n}`, subject: 'Re: Quarterly plan', sentAt: `2026-10-${String(10 + (n % 18)).padStart(2, '0')}T15:00:00Z`, body, ...base, ...over,
});

export const OWNER = { account: 'sam@example.test', owner: ['sam@example.test', 'example.test'] };

export const SENT: SentMessage[] = [
  sent('Hi Alex,\n\nFriday works. I\'ll send the deck Thursday night so you have time to look.\n\nThanks,\nSam\n\nSam Owner | CEO\n+1 425 555 0100\n\nOn Tue, Oct 14, 2026 at 9:00 AM Alex Rivera <alex@partner.example.test> wrote:\n> Can we meet Friday?\n> I hope this email finds you well.'),
  sent('Hi Jordan,\n\nYes. Go ahead and book it. We can sort out the budget line later.\n\nThanks,\nSam', { to: [{ name: 'Jordan Lee', address: 'jordan@example.test' }], subject: 'Re: Offsite venue' }),
  sent('Alex,\n\nNot this quarter. We\'re heads down on the launch and I don\'t want to split focus. Ping me in January and we\'ll take another look.\n\nThanks,\nSam\n\n-----Original Message-----\nFrom: Alex Rivera\nSent: Monday\nWould you be open to a pilot?'),
  sent('Hi Priya,\n\nThanks for the notes. Two things:\n\nThe pricing page still says monthly only. Can you add annual?\nI\'d drop the FAQ section. Nobody reads it.\n\nOtherwise it\'s good to ship.\n\nThanks,\nSam', { to: [{ name: 'Priya Shah', address: 'priya@example.test' }], subject: 'Re: Site copy' }),
  sent('Hi Chris,\n\nLooping in Jordan, who owns this now. Jordan, can you take it from here?\n\nThanks,\nSam', { to: [{ name: 'Chris Park', address: 'chris@vendor.example.test' }], subject: 'Re: Invoice question' }),
  sent('Sounds good. Thanks!\n\nSam', { subject: 'Re: Call moved to 3pm' }),
  sent('Hi Alex,\n\nI read through the proposal and I think the scope is right, but the timeline is tight. We\'d need the API done by mid-November for the rest to hold, and I don\'t see that happening with the current team. If you can add a second engineer for six weeks, I\'m in. If not, let\'s cut the reporting piece and ship it in a follow-up. Call me at 425-555-0199 if it\'s easier to talk it through.\n\nThanks,\nSam', { subject: 'Re: SOW draft' }),
  sent('Automatic reply: I\'m out of office until Monday.', { subject: 'Automatic reply: Quarterly plan' }),
  sent('', { subject: 'Fw: Article' }),
  sent('Hi Dana,\n\nGot it. I\'ll sign tonight.\n\nThanks,\nSam', { to: [{ name: 'Dana Cole', address: 'dana@counsel.example.test' }], subject: 'Re: Engagement letter' }),
];
