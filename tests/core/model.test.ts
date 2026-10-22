import {
  assertValid,
  createProject,
  createSection,
  createTask,
  isIsoDate,
  ModelValidationError,
  validateProject,
  validateRecurrence,
  validateSection,
  validateTask,
} from '../../src/core/model';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('factories', () => {
  // @req FR:task-model/model.defaults
  it('createTask applies defaults', () => {
    const t = createTask({ id: 't1', title: 'Do it' });
    expect(t.status).toBe('todo');
    expect(t.autonomy).toBe('none');
    expect(t.notes).toEqual([]);
    expect(t.subtasks).toEqual([]);
  });

  // @req FR:task-model/model.defaults
  it('createTask keeps supplied values', () => {
    const t = createTask({ id: 't1', title: 'x', status: 'done', autonomy: 'full', dueDate: '2026-01-02' });
    expect(t.status).toBe('done');
    expect(t.autonomy).toBe('full');
    expect(t.dueDate).toBe('2026-01-02');
  });

  // @req FR:task-model/model.output
  it('returns independent arrays', () => {
    const a = createTask({ id: 'a', title: 'a' });
    const b = createTask({ id: 'b', title: 'b' });
    a.notes.push('n');
    expect(b.notes).toEqual([]);
    expect(createSection('s').tasks).not.toBe(createSection('s').tasks);
    expect(createProject({ id: 'p', name: 'P' }).aliases).toEqual([]);
  });

  // @req FR:task-model/model.@function
  it('createProject and createSection build empty containers', () => {
    const p = createProject({ id: 'p', name: 'P' });
    expect(p.sections).toEqual([]);
    expect(createSection('Today', [a()]).tasks).toHaveLength(1);
  });
});

function a() {
  return createTask({ id: 'x', title: 'x' });
}

describe('entities', () => {
  // @req FR:task-model/$task
  it('task carries every field', () => {
    const t = createTask({
      id: 't', title: 't', priority: 2, impact: 3, effort: 15, value: 4,
      startDate: '2026-01-01', dueDate: '2026-01-02', recurrence: { cadence: 'daily' },
      autonomy: 'assist', notes: ['n'], subtasks: [createTask({ id: 's', title: 's' })],
    });
    expect(validateTask(t)).toEqual([]);
    expect(Object.keys(t).sort()).toEqual(['autonomy', 'dueDate', 'effort', 'id', 'impact', 'notes', 'priority', 'recurrence', 'startDate', 'status', 'subtasks', 'title', 'value']);
  });

  // @req FR:task-model/$section
  it('section has name and tasks', () => {
    expect(createSection('S')).toEqual({ name: 'S', tasks: [] });
  });

  // @req FR:task-model/$project
  it('project has defaults', () => {
    expect(createProject({ id: 'p', name: 'P' })).toEqual({ id: 'p', name: 'P', aliases: [], sections: [] });
  });

  // @req FR:task-model/$recurrence
  it('recurrence accepts every cadence', () => {
    for (const cadence of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const) {
      expect(validateRecurrence({ cadence })).toEqual([]);
    }
  });

  // @req FR:task-model/model.dates
  it('dates stay ISO strings', () => {
    expect(typeof createTask({ id: 't', title: 't', dueDate: '2026-05-06' }).dueDate).toBe('string');
  });

  // @req FR:task-model/validate.@function
  it('exports the validation surface', () => {
    for (const fn of [validateTask, validateSection, validateProject, validateRecurrence, isIsoDate, assertValid]) {
      expect(typeof fn).toBe('function');
    }
  });
});

describe('isIsoDate', () => {
  // @req FR:task-model/validate.dates
  it('accepts real dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  // @req FR:task-model/validate.dates
  it('rejects bad dates', () => {
    for (const s of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-1', 'Mar 3, 2026', '', '2026-00-10', '2026-01-00']) {
      expect(isIsoDate(s)).toBe(false);
    }
    expect(isIsoDate(undefined as unknown as string)).toBe(false);
  });
});

describe('validateTask', () => {
  // @req FR:task-model/validate.output
  it('returns empty list for a valid task', () => {
    expect(validateTask(createTask({ id: 't', title: 'ok', priority: 1, impact: 5, effort: 30, value: 0 }))).toEqual([]);
  });

  // @req FR:task-model/validate.title
  it('rejects blank title and id', () => {
    const issues = validateTask(createTask({ id: ' ', title: '  ' }));
    expect(paths(issues)).toEqual(expect.arrayContaining(['id', 'title']));
    expect(codes(issues)).toEqual(['required', 'required']);
  });

  // @req FR:task-model/validate.enums
  it('rejects unknown status and autonomy', () => {
    const t = createTask({ id: 't', title: 't' }) as any;
    t.status = 'nope';
    t.autonomy = 'yolo';
    const issues = validateTask(t);
    expect(codes(issues)).toEqual(['invalid-enum', 'invalid-enum']);
  });

  // @req FR:task-model/validate.numbers
  it('rejects out-of-range numbers', () => {
    const t = createTask({ id: 't', title: 't', priority: 0, impact: 6, effort: 0, value: -1 });
    expect(paths(validateTask(t)).sort()).toEqual(['effort', 'impact', 'priority', 'value']);
  });

  // @req FR:task-model/validate.numbers
  it('rejects non-integers for priority/impact and non-finite values', () => {
    const t = createTask({ id: 't', title: 't', priority: 1.5, impact: NaN, effort: Infinity });
    expect(paths(validateTask(t)).sort()).toEqual(['effort', 'impact', 'priority']);
  });

  // @req FR:task-model/validate.dates
  it('rejects invalid dates', () => {
    const t = createTask({ id: 't', title: 't', startDate: '2026-02-30', dueDate: 'soon' });
    expect(codes(validateTask(t))).toEqual(['invalid-date', 'invalid-date']);
  });

  // @req FR:task-model/validate.dates.order
  it('rejects start after due and allows equal', () => {
    expect(codes(validateTask(createTask({ id: 't', title: 't', startDate: '2026-03-02', dueDate: '2026-03-01' })))).toEqual(['date-order']);
    expect(validateTask(createTask({ id: 't', title: 't', startDate: '2026-03-01', dueDate: '2026-03-01' }))).toEqual([]);
  });

  // @req FR:task-model/validate.collect
  it('collects every issue', () => {
    const t = createTask({ id: '', title: '', priority: 9, dueDate: 'x' });
    expect(validateTask(t).length).toBe(4);
  });

  // @req FR:task-model/validate.subtasks
  it('validates subtasks recursively with indexed paths', () => {
    const t = createTask({
      id: 't',
      title: 't',
      subtasks: [createTask({ id: 's', title: 's' }), createTask({ id: 's2', title: '', subtasks: [createTask({ id: 's3', title: 'x', effort: -1 })] })],
    });
    expect(paths(validateTask(t))).toEqual(['subtasks[1].title', 'subtasks[1].subtasks[0].effort']);
  });

  // @req FR:task-model/validate.input
  it('rejects non-object input', () => {
    expect(codes(validateTask(null as any))).toEqual(['required']);
  });
});

describe('validateRecurrence', () => {
  // @req FR:task-model/validate.recurrence
  it('accepts valid recurrences', () => {
    expect(validateRecurrence({ cadence: 'weekly', weekdays: ['mon', 'thu'] })).toEqual([]);
    expect(validateRecurrence({ cadence: 'quarterly', anchor: 'end-of-month', offsetDays: 1, nominalDay: '2026-03-31' })).toEqual([]);
  });

  // @req FR:task-model/validate.enums
  it('rejects unknown cadence, weekday, anchor', () => {
    const r = { cadence: 'hourly', weekdays: ['funday'], anchor: 'mid' } as any;
    expect(codes(validateRecurrence(r))).toEqual(['invalid-enum', 'invalid-enum', 'invalid-enum']);
  });

  // @req FR:task-model/validate.recurrence.weekdays
  it('rejects weekdays on non-weekly cadence', () => {
    expect(codes(validateRecurrence({ cadence: 'monthly', weekdays: ['mon'] }))).toEqual(['invalid-recurrence']);
  });

  // @req FR:task-model/validate.recurrence.offset
  it('rejects non-integer offset and bad nominalDay', () => {
    const issues = validateRecurrence({ cadence: 'monthly', offsetDays: 1.5, nominalDay: '2026-02-31' });
    expect(paths(issues)).toEqual(['offsetDays', 'nominalDay']);
  });

  // @req FR:task-model/validate.recurrence
  it('requires a dueDate on recurring tasks', () => {
    const t = createTask({ id: 't', title: 't', recurrence: { cadence: 'daily' } });
    expect(codes(validateTask(t))).toEqual(['recurrence-needs-due']);
    t.dueDate = '2026-01-01';
    expect(validateTask(t)).toEqual([]);
  });

  // @req FR:task-model/validate.recurrence
  it('prefixes recurrence paths from the task', () => {
    const t = createTask({ id: 't', title: 't', dueDate: '2026-01-01', recurrence: { cadence: 'x' as any } });
    expect(paths(validateTask(t))).toEqual(['recurrence.cadence']);
  });
});

describe('validateSection / validateProject', () => {
  // @req FR:task-model/validate.title
  it('rejects blank names', () => {
    expect(codes(validateSection(createSection(' ')))).toEqual(['required']);
    expect(paths(validateProject(createProject({ id: '', name: '' })))).toEqual(['id', 'name']);
  });

  // @req FR:task-model/validate.numbers
  it('rejects bad projectValue and capacity', () => {
    const p = createProject({ id: 'p', name: 'P', projectValue: -1, capacity: NaN });
    expect(paths(validateProject(p))).toEqual(['projectValue', 'capacity']);
  });

  // @req FR:task-model/validate.subtasks
  it('reports nested paths from project down', () => {
    const p = createProject({ id: 'p', name: 'P', sections: [createSection('S', [createTask({ id: 't', title: '' })])] });
    expect(paths(validateProject(p))).toEqual(['sections[0].tasks[0].title']);
  });

  // @req FR:task-model/validate.unique
  it('rejects duplicate task ids across sections and subtasks', () => {
    const p = createProject({
      id: 'p',
      name: 'P',
      sections: [
        createSection('A', [createTask({ id: 't', title: 'a', subtasks: [createTask({ id: 'u', title: 'u' })] })]),
        createSection('B', [createTask({ id: 't', title: 'b' }), createTask({ id: 'u', title: 'u2' })]),
      ],
    });
    const issues = validateProject(p);
    expect(codes(issues)).toEqual(['duplicate', 'duplicate']);
    expect(paths(issues)).toEqual(['sections[1].tasks[0].id', 'sections[1].tasks[1].id']);
  });

  // @req FR:task-model/validate.unique
  it('rejects duplicate section names', () => {
    const p = createProject({ id: 'p', name: 'P', sections: [createSection('A'), createSection('a')] });
    expect(paths(validateProject(p))).toEqual(['sections[1].name']);
  });

  // @req FR:task-model/validate.unique.aliases
  it('rejects repeated aliases and alias equal to name', () => {
    const p = createProject({ id: 'p', name: 'Home', aliases: ['H', 'h', 'home'] });
    expect(paths(validateProject(p))).toEqual(['aliases[1]', 'aliases[2]']);
  });

  // @req FR:task-model/validate.output
  it('accepts a valid project', () => {
    const p = createProject({ id: 'p', name: 'P', aliases: ['x'], projectValue: 3, capacity: 600, sections: [createSection('S', [createTask({ id: 't', title: 't' })])] });
    expect(validateProject(p)).toEqual([]);
  });
});

describe('assertValid', () => {
  // @req FR:task-model/validate.assert
  it('does nothing for no issues', () => {
    expect(() => assertValid([])).not.toThrow();
  });

  // @req FR:task-model/validate.assert
  it('throws ModelValidationError carrying issues', () => {
    const issues = validateTask(createTask({ id: '', title: '' }));
    try {
      assertValid(issues);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ModelValidationError);
      expect((e as ModelValidationError).issues).toEqual(issues);
      expect((e as Error).message).toContain('id');
    }
  });
});
