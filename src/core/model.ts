/**
 * Format-neutral task model and validation.
 * No parsing, IO, or formatting lives here.
 */

/**
 * ISO `YYYY-MM-DD` calendar date.
 * @req FR:task-model/model.dates
 */
export type IsoDate = string;

export const TASK_STATUSES = ['todo', 'active', 'done', 'skipped', 'parked', 'suspended'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AUTONOMY_LEVELS = ['none', 'triage', 'assist', 'full'] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const ANCHORS = ['end-of-month'] as const;
export type Anchor = (typeof ANCHORS)[number];

/**
 * How a task repeats.
 * @req FR:task-model/$recurrence
 */
export interface Recurrence {
  cadence: Cadence;
  /** Weekly only. */
  weekdays?: Weekday[];
  anchor?: Anchor;
  /** Integer days from the anchor, e.g. `Quarterly-EOM+1`. */
  offsetDays?: number;
  /** Date retained so rolls do not drift off weekends. */
  nominalDay?: IsoDate;
}

/**
 * One unit of work.
 * @req FR:task-model/$task
 */
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** Integer 1-5, 1 is highest. */
  priority?: number;
  /** Integer 1-5. */
  impact?: number;
  /** Minutes, greater than 0. */
  effort?: number;
  /** Zero or greater. */
  value?: number;
  startDate?: IsoDate;
  dueDate?: IsoDate;
  recurrence?: Recurrence;
  autonomy: Autonomy;
  notes: string[];
  subtasks: Task[];
}

/** @req FR:task-model/$section */
export interface Section {
  name: string;
  tasks: Task[];
}

/** @req FR:task-model/$project */
export interface Project {
  id: string;
  name: string;
  aliases: string[];
  projectValue?: number;
  /** Minutes per week. */
  capacity?: number;
  sections: Section[];
}

export type IssueCode =
  | 'required'
  | 'invalid-enum'
  | 'out-of-range'
  | 'invalid-date'
  | 'date-order'
  | 'duplicate'
  | 'recurrence-needs-due'
  | 'invalid-recurrence';

export interface ValidationIssue {
  path: string;
  code: IssueCode;
  message: string;
}

/**
 * Thrown by {@link assertValid}.
 * @req FR:task-model/validate.assert
 */
export class ModelValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Invalid model: ${issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')}`);
    this.name = 'ModelValidationError';
  }
}

// ---------------------------------------------------------------- factories

/**
 * Build a task with defaults.
 * @req FR:task-model/model.defaults
 * @req FR:task-model/model.output
 */
export function createTask(init: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    ...init,
    status: init.status ?? 'todo',
    autonomy: init.autonomy ?? 'none',
    notes: [...(init.notes ?? [])],
    subtasks: [...(init.subtasks ?? [])],
  };
}

/** @req FR:task-model/model.@function */
export function createSection(name: string, tasks: Task[] = []): Section {
  return { name, tasks: [...tasks] };
}

/** @req FR:task-model/model.@function */
export function createProject(init: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    ...init,
    aliases: [...(init.aliases ?? [])],
    sections: [...(init.sections ?? [])],
  };
}

// --------------------------------------------------------------- validation

/**
 * Strict calendar check for `YYYY-MM-DD`.
 * @req FR:task-model/validate.dates
 */
export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Uniqueness key: trimmed, case-insensitive. Used for task ids, section names, aliases. */
const uniqueKey = (s: string) => s.trim().toLowerCase();

const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

function issue(path: string, code: IssueCode, message: string): ValidationIssue {
  return { path, code, message };
}

function checkText(v: unknown, path: string, out: ValidationIssue[], label: string): void {
  if (typeof v !== 'string' || v.trim() === '') out.push(issue(path, 'required', `${label} is required`));
}

function checkEnum(v: unknown, allowed: readonly string[], path: string, out: ValidationIssue[]): void {
  if (typeof v !== 'string' || !allowed.includes(v)) {
    out.push(issue(path, 'invalid-enum', `must be one of: ${allowed.join(', ')}`));
  }
}

function checkNumber(
  v: unknown,
  path: string,
  out: ValidationIssue[],
  opts: { min: number; max?: number; integer?: boolean; exclusiveMin?: boolean },
): void {
  if (v === undefined) return;
  const bad =
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    (opts.integer && !Number.isInteger(v)) ||
    (opts.exclusiveMin ? v <= opts.min : v < opts.min) ||
    (opts.max !== undefined && v > opts.max);
  if (bad) out.push(issue(path, 'out-of-range', `must be ${opts.integer ? 'an integer ' : 'a number '}${opts.max !== undefined ? `between ${opts.min} and ${opts.max}` : `${opts.exclusiveMin ? '>' : '>='} ${opts.min}`}`));
}

function checkDate(v: unknown, path: string, out: ValidationIssue[]): void {
  if (v !== undefined && !isIsoDate(v)) out.push(issue(path, 'invalid-date', 'must be a real date in YYYY-MM-DD form'));
}

/**
 * Leniency (intentional, see FR:validate.recurrence.lenient): an empty `weekdays` list,
 * and `anchor`/`offsetDays` on any cadence, are accepted. `nominalDay` is checked as a
 * date only and is not tied to `dueDate` or cadence.
 * @req FR:task-model/validate.recurrence
 * @req FR:task-model/validate.enums
 */
export function validateRecurrence(r: Recurrence, path = ''): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (r === null || typeof r !== 'object') return [issue(path, 'required', 'recurrence must be an object')];
  checkEnum(r.cadence, CADENCES, join(path, 'cadence'), out);
  if (r.weekdays !== undefined) {
    if (!Array.isArray(r.weekdays)) {
      out.push(issue(join(path, 'weekdays'), 'invalid-enum', `must be a list of: ${WEEKDAYS.join(', ')}`));
    } else {
      const seenDays = new Set<unknown>();
      r.weekdays.forEach((w, i) => {
        const wp = `${join(path, 'weekdays')}[${i}]`;
        checkEnum(w, WEEKDAYS, wp, out);
        // @req FR:task-model/validate.recurrence.weekdays.unique
        if (seenDays.has(w)) out.push(issue(wp, 'duplicate', `weekday "${String(w)}" is repeated`));
        seenDays.add(w);
      });
      // @req FR:task-model/validate.recurrence.weekdays
      if ((CADENCES as readonly string[]).includes(r.cadence) && r.cadence !== 'weekly') {
        out.push(issue(join(path, 'weekdays'), 'invalid-recurrence', 'weekdays apply only to weekly cadence'));
      }
    }
  }
  if (r.anchor !== undefined) checkEnum(r.anchor, ANCHORS, join(path, 'anchor'), out);
  // @req FR:task-model/validate.recurrence.offset
  if (r.offsetDays !== undefined && !Number.isInteger(r.offsetDays)) {
    out.push(issue(join(path, 'offsetDays'), 'out-of-range', 'must be an integer'));
  }
  checkDate(r.nominalDay, join(path, 'nominalDay'), out);
  return out;
}

/**
 * @req FR:task-model/validate.title
 * @req FR:task-model/validate.required
 * @req FR:task-model/validate.enums
 * @req FR:task-model/validate.numbers
 * @req FR:task-model/validate.dates
 * @req FR:task-model/validate.subtasks
 * @req FR:task-model/validate.collect
 * @req FR:task-model/validate.@function
 * @req FR:task-model/validate.input
 * @req FR:task-model/validate.output
 */
export function validateTask(t: Task, path = ''): ValidationIssue[] {
  if (t === null || typeof t !== 'object') return [issue(path, 'required', 'task must be an object')];
  const out: ValidationIssue[] = [];
  checkText(t.id, join(path, 'id'), out, 'id');
  checkText(t.title, join(path, 'title'), out, 'title');
  checkEnum(t.status, TASK_STATUSES, join(path, 'status'), out);
  checkEnum(t.autonomy, AUTONOMY_LEVELS, join(path, 'autonomy'), out);
  checkNumber(t.priority, join(path, 'priority'), out, { min: 1, max: 5, integer: true });
  checkNumber(t.impact, join(path, 'impact'), out, { min: 1, max: 5, integer: true });
  checkNumber(t.effort, join(path, 'effort'), out, { min: 0, exclusiveMin: true });
  checkNumber(t.value, join(path, 'value'), out, { min: 0 });
  checkDate(t.startDate, join(path, 'startDate'), out);
  checkDate(t.dueDate, join(path, 'dueDate'), out);
  // @req FR:task-model/validate.dates.order
  if (isIsoDate(t.startDate) && isIsoDate(t.dueDate) && t.startDate > t.dueDate) {
    out.push(issue(join(path, 'startDate'), 'date-order', 'startDate must not be after dueDate'));
  }
  if (t.recurrence !== undefined) {
    out.push(...validateRecurrence(t.recurrence, join(path, 'recurrence')));
    if (t.dueDate === undefined) {
      out.push(issue(join(path, 'dueDate'), 'recurrence-needs-due', 'recurring tasks need a dueDate'));
    }
  }
  if (!Array.isArray(t.notes)) out.push(issue(join(path, 'notes'), 'required', 'notes must be a list'));
  if (!Array.isArray(t.subtasks)) {
    out.push(issue(join(path, 'subtasks'), 'required', 'subtasks must be a list'));
  } else {
    t.subtasks.forEach((s, i) => out.push(...validateTask(s, `${join(path, 'subtasks')}[${i}]`)));
  }
  return out;
}

/**
 * @req FR:task-model/validate.title
 */
export function validateSection(s: Section, path = ''): ValidationIssue[] {
  if (s === null || typeof s !== 'object') return [issue(path, 'required', 'section must be an object')];
  const out: ValidationIssue[] = [];
  checkText(s.name, join(path, 'name'), out, 'name');
  if (!Array.isArray(s.tasks)) {
    out.push(issue(join(path, 'tasks'), 'required', 'tasks must be a list'));
  } else {
    s.tasks.forEach((t, i) => out.push(...validateTask(t, `${join(path, 'tasks')}[${i}]`)));
  }
  return out;
}

/**
 * @req FR:task-model/validate.required
 * @req FR:task-model/validate.unique
 * @req FR:task-model/validate.unique.aliases
 */
export function validateProject(p: Project, path = ''): ValidationIssue[] {
  if (p === null || typeof p !== 'object') return [issue(path, 'required', 'project must be an object')];
  const out: ValidationIssue[] = [];
  checkText(p.id, join(path, 'id'), out, 'id');
  checkText(p.name, join(path, 'name'), out, 'name');
  checkNumber(p.projectValue, join(path, 'projectValue'), out, { min: 0 });
  checkNumber(p.capacity, join(path, 'capacity'), out, { min: 0 });

  const seenNames = new Set<string>(typeof p.name === 'string' ? [uniqueKey(p.name)] : []);
  if (!Array.isArray(p.aliases)) {
    out.push(issue(join(path, 'aliases'), 'required', 'aliases must be a list'));
  } else {
    p.aliases.forEach((a, i) => {
      const ap = `${join(path, 'aliases')}[${i}]`;
      checkText(a, ap, out, 'alias');
      if (typeof a !== 'string' || a.trim() === '') return;
      const key = uniqueKey(a);
      if (seenNames.has(key)) out.push(issue(ap, 'duplicate', `alias "${a}" repeats another alias or the project name`));
      seenNames.add(key);
    });
  }

  if (!Array.isArray(p.sections)) {
    out.push(issue(join(path, 'sections'), 'required', 'sections must be a list'));
    return out;
  }
  const sectionNames = new Set<string>();
  const taskIds = new Set<string>();
  const dupIssues: ValidationIssue[] = [];
  const walk = (tasks: Task[], base: string) => {
    if (!Array.isArray(tasks)) return;
    tasks.forEach((t, i) => {
      if (t === null || typeof t !== 'object') return;
      const tp = `${base}[${i}]`;
      if (typeof t.id === 'string' && t.id.trim() !== '') {
        const key = uniqueKey(t.id);
        if (taskIds.has(key)) dupIssues.push(issue(`${tp}.id`, 'duplicate', `task id "${t.id}" is used more than once in the project`));
        taskIds.add(key);
      }
      walk(t.subtasks, `${tp}.subtasks`);
    });
  };
  p.sections.forEach((s, i) => {
    const sp = `${join(path, 'sections')}[${i}]`;
    out.push(...validateSection(s, sp));
    if (s === null || typeof s !== 'object') return;
    if (typeof s.name === 'string' && s.name.trim() !== '') {
      const key = uniqueKey(s.name);
      if (sectionNames.has(key)) dupIssues.push(issue(`${sp}.name`, 'duplicate', `section name "${s.name}" is used more than once in the project`));
      sectionNames.add(key);
    }
    walk(s.tasks, `${sp}.tasks`);
  });
  return [...out, ...dupIssues];
}

/**
 * Throw when any issue exists.
 * @req FR:task-model/validate.assert
 */
export function assertValid(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new ModelValidationError(issues);
}
