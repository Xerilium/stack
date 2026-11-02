/** Live-deploy requirements a human checks: each skip says what to look for and why no test does it. */
describe('live-deploy: human checks', () => {
  // @req FR:live-deploy/web.state.announce — cannot be automated: a screen reader must hear the sync state change politely (role=status in LiveBadge); no test drives assistive output
  it.skip('a sync state change is announced politely by a screen reader', () => undefined);
  // @req NFR:live-deploy/security.text — cannot be automated: that the host sends no task or ask text to a model is a property of the deployment, not of the code under test
  it.skip('the host never sends task or ask text to a model', () => undefined);
});
