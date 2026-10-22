import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FormatterError, convert, detectFormat, emojiFormatter, cleanFormatter, getFormatter, renderOutputs,
} from '../../src/core/formatter';
import { parseConfig, ConfigError } from '../../src/core/config';
import { parseProject, serializeProject } from '../../src/core/parser';

const dir = join(__dirname, '..', 'fixtures', 'formatter');
const read = (n: string) => readFileSync(join(dir, n), 'utf8');
const names = ['finance', 'minimal'];

// @req FR:formatter-clean/iface.@type @req FR:formatter-clean/iface.registry
describe('registry', () => {
  it('returns formatters by id', () => {
    expect(getFormatter('emoji')).toBe(emojiFormatter);
    expect(getFormatter('clean')).toBe(cleanFormatter);
    expect(emojiFormatter.extension).toBe('.md');
    expect(cleanFormatter.extension).toBe('.yaml');
  });
  it('rejects unknown ids', () => {
    expect(() => getFormatter('nope' as never)).toThrow(FormatterError);
  });
});

// @req FR:formatter-clean/iface.detect
describe('detectFormat', () => {
  it('maps extensions', () => {
    expect(detectFormat('a/b.yaml')).toBe('clean');
    expect(detectFormat('a/b.YML')).toBe('clean');
    expect(detectFormat('a/b.md')).toBe('emoji');
    expect(detectFormat('b')).toBe('emoji');
  });
});

// @req FR:formatter-clean/emoji.adapter
describe('emoji formatter', () => {
  it('matches the task-parser byte for byte, even for non-canonical input', () => {
    const odd = '﻿# T\r\n\r\n- [X] a\r\n\t- [ ] b\r\n### sub\r\nprose';
    expect(emojiFormatter.serialize(emojiFormatter.parse(odd))).toBe(odd);
    expect(emojiFormatter.parse(read('finance.md'))).toEqual(
      expect.objectContaining({ title: parseProject(read('finance.md')).title }));
    expect(serializeProject(parseProject(''))).toBe(emojiFormatter.serialize(emojiFormatter.parse('')));
  });
});

// @req FR:formatter-clean/emoji.generate
describe('emoji generation from a tree', () => {
  it('emits canonical markdown', () => {
    const p = cleanFormatter.parse(read('finance.yaml'));
    expect(p.lines).toEqual([]);
    expect(emojiFormatter.serialize(p)).toBe(read('finance.md'));
  });
  it('handles empty projects', () => {
    expect(emojiFormatter.serialize(cleanFormatter.parse('title: X\n'))).toBe('# X\n');
  });
});

// @req FR:formatter-clean/clean.shape @req FR:formatter-clean/clean.parse @req FR:formatter-clean/clean.serialize
describe('clean formatter', () => {
  it.each(names)('parses to the same tree as the emoji parser (%s)', n => {
    const strip = (p: ReturnType<typeof parseProject>) => JSON.parse(JSON.stringify({
      title: p.title, metadata: p.metadata,
      sections: p.sections,
    }, (k, v) => (k === 'line' || k === 'depth' ? undefined : v)));
    expect(strip(cleanFormatter.parse(read(`${n}.yaml`)))).toEqual(strip(emojiFormatter.parse(read(`${n}.md`))));
  });
  it.each(names)('serializes fixture deterministically (%s)', n => {
    expect(cleanFormatter.serialize(cleanFormatter.parse(read(`${n}.yaml`)))).toBe(read(`${n}.yaml`));
  });
  it('marks parsed tasks with line -1', () => {
    expect(cleanFormatter.parse(read('minimal.yaml')).sections[0].tasks[0].line).toBe(-1);
  });
});

// @req FR:formatter-clean/clean.invalid
describe('clean validation', () => {
  it.each([
    ['not yaml: [', /./],
    ['- a\n', /root/],
    ['title: 1\n', /title/],
    ['sections: {}\n', /sections/],
    ['sections:\n  - tasks: []\n', /sections\[0\]\.heading/],
    ['sections:\n  - heading: A\n    tasks:\n      - text: x\n', /sections\[0\]\.tasks\[0\]\.done/],
    ['sections:\n  - heading: A\n    tasks:\n      - text: x\n        done: false\n        notes: [1]\n', /notes/],
    ['metadata:\n  a: 1\n', /metadata\.a/],
    ['titl: x\n', /titl: unknown key/],
    ['sections:\n  - heading: A\n    task: []\n', /sections\[0\]\.task: unknown key/],
    ['sections:\n  - heading: A\n    tasks:\n      - text: x\n        done: false\n        subtask: []\n', /tasks\[0\]\.subtask: unknown key/],
  ])('rejects %j', (src, re) => {
    expect(() => cleanFormatter.parse(src)).toThrow(FormatterError);
    expect(() => cleanFormatter.parse(src)).toThrow(re);
  });
});

// @req FR:formatter-clean/clean.set-checked
describe('setChecked on clean projects', () => {
  it('is reflected in output', () => {
    const p = cleanFormatter.parse(read('minimal.yaml'));
    p.setChecked(p.sections[0].tasks[0], true);
    expect(cleanFormatter.serialize(p)).toContain('done: true');
    expect(emojiFormatter.serialize(p)).toContain('- [x] One');
  });
});

// @req FR:formatter-clean/select.config @req FR:formatter-clean/select.also
describe('config keys', () => {
  it('defaults', () => {
    const c = parseConfig();
    expect(c.format).toBe('emoji');
    expect(c.alsoWrite).toEqual([]);
  });
  it('accepts valid values', () => {
    const c = parseConfig({ format: 'clean', alsoWrite: ['emoji'] });
    expect(c.format).toBe('clean');
    expect(c.alsoWrite).toEqual(['emoji']);
  });
  it.each([
    [{ format: 'xml' }],
    [{ format: 1 }],
    [{ alsoWrite: 'emoji' }],
    [{ alsoWrite: ['xml'] }],
    [{ alsoWrite: ['emoji'] }],
    [{ format: 'clean', alsoWrite: ['clean'] }],
    [{ alsoWrite: ['clean', 'clean'] }],
  ])('rejects %j', input => {
    expect(() => parseConfig(input)).toThrow(ConfigError);
  });
});

// @req FR:formatter-clean/select.render
describe('renderOutputs', () => {
  const p = emojiFormatter.parse(read('minimal.md'));
  it('renders only primary by default', () => {
    const out = renderOutputs(p, parseConfig());
    expect(out).toEqual([{ format: 'emoji', extension: '.md', content: read('minimal.md') }]);
  });
  it('renders primary first, then extras', () => {
    const out = renderOutputs(p, parseConfig({ format: 'clean', alsoWrite: ['emoji'] }));
    expect(out.map(o => o.format)).toEqual(['clean', 'emoji']);
    expect(out[0].content).toBe(read('minimal.yaml'));
    expect(out[1].content).toBe(read('minimal.md'));
  });
});

// @req FR:formatter-clean/convert.fn @req FR:formatter-clean/convert.emoji-clean-emoji @req FR:formatter-clean/convert.clean-emoji-clean
describe('converters', () => {
  it.each(names)('emoji to clean matches fixture (%s)', n => {
    expect(convert(read(`${n}.md`), 'emoji', 'clean')).toBe(read(`${n}.yaml`));
  });
  it.each(names)('emoji -> clean -> emoji is byte-exact (%s)', n => {
    const md = read(`${n}.md`);
    expect(convert(convert(md, 'emoji', 'clean'), 'clean', 'emoji')).toBe(md);
  });
  it.each(names)('clean -> emoji -> clean is byte-exact (%s)', n => {
    const y = read(`${n}.yaml`);
    expect(convert(convert(y, 'clean', 'emoji'), 'emoji', 'clean')).toBe(y);
  });
  it('same-format convert is a normal parse/serialize', () => {
    expect(convert(read('minimal.md'), 'emoji', 'emoji')).toBe(read('minimal.md'));
  });
  it('keeps structure when input is non-canonical', () => {
    const y = convert('﻿# T\r\n\r\n## S\r\n\r\n- [X] a\r\n  - [ ] b\r\n', 'emoji', 'clean');
    expect(convert(y, 'clean', 'emoji')).toBe('# T\n\n## S\n\n- [x] a\n  - [ ] b\n');
  });
});
