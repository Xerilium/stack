/** @req FR:web-shell/state.errors */
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../src/api';
import { errCause, errText, UserError } from '../src/errtext';

const f = (code: string, message: string, details?: { field: string; message: string }[], status = 400) => new ApiFailure(status, code, message, details);

describe('errText', () => {
  // @req FR:web-shell/state.errors.code
  it('conflict: says it changed elsewhere and to reload', () => {
    expect(errText(f('conflict', 'Conflict', undefined, 409), 'save the task')).toBe('Changed somewhere else. Reload, then try again.');
  });
  // @req FR:web-shell/state.errors.code
  it('not_found: says the item is gone and to reload', () => {
    expect(errText(f('not_found', 'Not found', undefined, 404), 'save the task')).toBe('This item no longer exists. Reload to see the latest.');
  });
  // @req FR:web-shell/state.errors.code
  it('invalid: the first detail message, else check the values', () => {
    expect(errText(f('invalid', 'Validation failed', [{ field: 'text', message: 'text is required' }, { field: 'x', message: 'x' }], 422), 'save the task')).toBe('text is required');
    expect(errText(f('invalid', 'Request cannot be applied', undefined, 422), 'save the task')).toBe('Could not save the task. Check the values and try again.');
    expect(errText(f('bad_request', 'Validation failed', [], 400), 'save the task')).toBe('Could not save the task. Try again.');
  });
  // @req FR:web-shell/state.errors.details
  it('field details show whatever the code', () => {
    expect(errText(f('bad_request', 'Validation failed', [{ field: 'pris[0].title', message: 'Too long' }], 400), 'save')).toBe('Too long');
  });
  // @req FR:web-shell/state.errors.code
  it('internal: try again, then send feedback', () => {
    expect(errText(f('internal', 'Internal error', undefined, 500), 'send the reply')).toBe('Could not send the reply. Try again. If it happens again, send feedback (F).');
    expect(errText(f('internal', 'Failed', undefined, 500), 'send the reply')).toBe('Could not send the reply. Try again. If it happens again, send feedback (F).');
  });
  // @req FR:web-shell/state.errors.code @req FR:web-shell/state.unreachable
  it('network and offline: keep the client text', () => {
    expect(errText(f('network', "Can't reach Stack at h. Is stack web still running?", undefined, 0), 'x')).toBe("Can't reach Stack at h. Is stack web still running?");
    expect(errText(f('offline', 'Offline: changes need a connection', undefined, 0), 'x')).toBe('Offline: changes need a connection');
  });
  // @req FR:web-shell/state.errors.code
  it('other codes and non-API errors: could not, try again', () => {
    expect(errText(f('forbidden', 'Forbidden', undefined, 403), 'move it')).toBe('Could not move it. This account is not allowed to do that.');
    expect(errText(f('http_502', 'Request failed (502)', undefined, 502), 'move it')).toBe('Could not move it. Try again.');
    expect(errText(new TypeError('x is undefined'), 'move it')).toBe('Could not move it. Try again.');
    expect(errText('boom', 'move it')).toBe('Could not move it. Try again.');
  });
  // @req FR:web-shell/state.errors.specific
  it('keeps a server message that names the cause', () => {
    expect(errText(new UserError('Reply with a reason to reject'), 'x')).toBe('Reply with a reason to reject');
    expect(errText(f('not_found', 'No live lane on this host', undefined, 404), 'x')).toBe('No live lane on this host');
    expect(errText(f('conflict', 'Inbox full: 50 open items', undefined, 409), 'x')).toBe('Inbox full: 50 open items');
    expect(errText(f('internal', 'Disk full', undefined, 500), 'x')).toBe('Disk full');
    expect(errText(f('forbidden', 'This PR is not on your board', undefined, 403), 'x')).toBe('This PR is not on your board');
  });
  // @req FR:web-shell/state.errors.prefixed
  it('no action: only the next step, for views that already say what failed', () => {
    expect(errText(f('internal', 'Internal error', undefined, 500))).toBe('Try again. If it happens again, send feedback (F).');
    expect(errText(f('invalid', 'Request cannot be applied', undefined, 422))).toBe('Check the values and try again.');
    expect(errText(f('bad_request', 'Validation failed'))).toBe('Try again.');
    expect(errText(new Error('x'))).toBe('Try again.');
    expect(errText(f('not_found', 'Not found', undefined, 404))).toBe('This item no longer exists. Reload to see the latest.');
  });
  // @req FR:web-shell/state.errors
  it('never returns only Failed', () => {
    for (const code of ['conflict', 'not_found', 'invalid', 'internal', 'bad_request', 'unavailable']) {
      expect(errText(f(code, 'Failed'), 'do it')).not.toBe('Failed');
    }
  });
});

describe('errCause', () => {
  // @req FR:web-shell/state.errors.specific
  it('the cause only when the error names one', () => {
    expect(errCause(f('internal', 'Internal error', undefined, 500))).toBe('');
    expect(errCause(f('conflict', 'Conflict', undefined, 409))).toBe('');
    expect(errCause(new Error('x'))).toBe('');
    expect(errCause(f('not_found', 'No live lane on this host', undefined, 404))).toBe('No live lane on this host');
    expect(errCause(new UserError('Reply with a reason to reject'))).toBe('Reply with a reason to reject');
  });
});
