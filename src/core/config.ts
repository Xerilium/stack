export class ConfigError extends Error {}

/** @req FR:config/$time-block */
export interface TimeBlock {
  name: string;
  label?: string;
  days: string[];
  startTime: string;
  endTime: string;
  emoji: string;
}

export interface TaskScoring {
  emojiWeights: Record<string, Record<string, number>>;
  effortHours: Record<string, number>;
}

/** @req FR:config/$stack-config */
export interface StackConfig {
  timezone: string;
  startOfDay: string;
  timeBlocks: TimeBlock[];
  taskScoring: TaskScoring;
}

const ALL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = ALL.slice(1, 6);
const block = (name: string, days: string[], startTime: string, endTime: string, emoji: string, label?: string): TimeBlock =>
  ({ name, ...(label ? { label } : {}), days, startTime, endTime, emoji });

const DEFAULTS_SOURCE: StackConfig = {
  timezone: 'America/Los_Angeles',
  startOfDay: '08:00',
  timeBlocks: [
    block('Work', WEEK, '08:00', '16:00', '☀️'),
    block('Family evening', WEEK, '16:00', '20:00', '🏠', 'Family'),
    block('Family weekend', ['Sat', 'Sun'], '08:00', '20:00', '🏠', 'Family'),
    block('Shichael', ALL, '20:00', '23:00', '💕'),
    block('Project', ALL, '23:00', '02:00', '🌙'),
    block('Sleep', ALL, '02:00', '08:00', '😴'),
  ],
  taskScoring: {
    emojiWeights: {
      priority: { '🔝': 1000, '🚨': 15, '‼️': 10, '🔺': 5, '🔻': -2 },
      status: { '🚧': 10, '⏸️': 5, '👀': 2, '⏳': -2, '⛔️': -5 },
      effort: { '🔹': 10, '🟢': 5, '🟡': 0, '🟠': -2, '🔴': -5, '⚫️': -10 },
      impact: { '⬆️': 10, '↔️': 5, '⬇️': -2 },
      value: { '💰': 25, '⚠️': 20, '😊': 15, '⏱️': 8, '🌱': 5, '🏃': 8, '🌟': 10 },
      timeBlocks: { default: 8 },
      special: { '📅': 2, '🎯': 10 },
    },
    effortHours: { '🔹': 0.2, '🟢': 0.5, '🟡': 1, '🟠': 2, '🔴': 4, '⚫️': 8 },
  },
};

/** Fresh copy of the baked-in defaults. */
export const getDefaults = (): StackConfig => structuredClone(DEFAULTS_SOURCE);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ConfigError(`${path}: expected string`);
  return v;
}
function time(v: unknown, path: string): string {
  const s = str(v, path);
  if (!TIME.test(s)) throw new ConfigError(`${path}: expected HH:mm`);
  return s;
}
function numMap(v: unknown, path: string): Record<string, number> {
  if (!isObj(v)) throw new ConfigError(`${path}: expected object`);
  for (const [k, n] of Object.entries(v)) if (typeof n !== 'number') throw new ConfigError(`${path}.${k}: expected number`);
  return v as Record<string, number>;
}

function parseBlock(v: unknown, path: string): TimeBlock {
  if (!isObj(v)) throw new ConfigError(`${path}: expected object`);
  if (!Array.isArray(v.days)) throw new ConfigError(`${path}.days: expected array`);
  for (const d of v.days) if (!ALL.includes(d as string)) throw new ConfigError(`${path}.days: invalid day ${String(d)}`);
  if (v.startTime === v.endTime) throw new ConfigError(`${path}: startTime equals endTime`);
  return {
    name: str(v.name, `${path}.name`),
    ...(v.label !== undefined ? { label: str(v.label, `${path}.label`) } : {}),
    days: v.days as string[],
    startTime: time(v.startTime, `${path}.startTime`),
    endTime: time(v.endTime, `${path}.endTime`),
    emoji: str(v.emoji, `${path}.emoji`),
  };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * @req FR:config/load.@function @req FR:config/load.input @req FR:config/load.output
 * @req FR:config/load.defaults @req FR:config/load.merge @req FR:config/load.validate
 * @req FR:config/load.timeblocks-replace @req FR:config/load.validate.time @req FR:config/load.validate.days @req FR:config/load.validate.timezone @req FR:config/load.validate.range
 */
export function parseConfig(input?: unknown): StackConfig {
  const cfg: StackConfig = structuredClone(DEFAULTS_SOURCE);
  if (input === undefined || input === null) return cfg;
  if (!isObj(input)) throw new ConfigError('config: expected object');
  if (input.timezone !== undefined) {
    cfg.timezone = str(input.timezone, 'timezone');
    if (!validZone(cfg.timezone)) throw new ConfigError(`timezone: unknown zone ${cfg.timezone}`);
  }
  if (input.startOfDay !== undefined) cfg.startOfDay = time(input.startOfDay, 'startOfDay');
  if (input.timeBlocks !== undefined) {
    if (!Array.isArray(input.timeBlocks)) throw new ConfigError('timeBlocks: expected array');
    cfg.timeBlocks = input.timeBlocks.map((b, i) => parseBlock(b, `timeBlocks[${i}]`));
  }
  if (input.taskScoring !== undefined) {
    if (!isObj(input.taskScoring)) throw new ConfigError('taskScoring: expected object');
    const ts = input.taskScoring;
    if (ts.emojiWeights !== undefined) {
      if (!isObj(ts.emojiWeights)) throw new ConfigError('taskScoring.emojiWeights: expected object');
      for (const [cat, m] of Object.entries(ts.emojiWeights)) {
        if (cat === '__proto__') continue;
        cfg.taskScoring.emojiWeights[cat] = {
          ...cfg.taskScoring.emojiWeights[cat],
          ...numMap(m, `taskScoring.emojiWeights.${cat}`),
        };
      }
    }
    if (ts.effortHours !== undefined) {
      cfg.taskScoring.effortHours = { ...cfg.taskScoring.effortHours, ...numMap(ts.effortHours, 'taskScoring.effortHours') };
    }
  }
  return cfg;
}

const mins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/**
 * @req FR:config/time-block.@function @req FR:config/time-block.input @req FR:config/time-block.output
 * @req FR:config/time-block.resolve @req FR:config/time-block.overnight @req FR:config/time-block.none @req FR:config/time-block.overlap
 */
export function getTimeBlock(config: StackConfig, at: Date): TimeBlock | undefined {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = get('weekday');
  const now = Number(get('hour')) * 60 + Number(get('minute'));
  const prev = ALL[(ALL.indexOf(day) + 6) % 7];
  for (const b of config.timeBlocks) {
    const s = mins(b.startTime);
    const e = mins(b.endTime);
    if (s < e) {
      if (b.days.includes(day) && now >= s && now < e) return b;
    } else {
      if (b.days.includes(day) && now >= s) return b;
      if (b.days.includes(prev) && now < e) return b;
    }
  }
  return undefined;
}
