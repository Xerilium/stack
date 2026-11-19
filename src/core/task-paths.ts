/**
 * Every task and system path rule in one place: the folder tree under `tasks/`, `.stack/` system folders at any level, and project IDs.
 * @req FR:task-structure/tree.path @req FR:task-structure/system.path @req FR:task-structure/id.project
 */

export const TASKS_DIR = 'tasks';
/** The system folder name at any level under `tasks/`. */
export const SYSTEM = '.stack';
/** The root system folder: new asks, agents, wake files, and the session log. @req FR:task-structure/system.root */
export const ROOT_SYSTEM = `${TASKS_DIR}/${SYSTEM}`;

/** One folder or file name: never empty, never starts with `.` (so `..` is never valid). */
const SEG = '[^/\\\\\\0.][^/\\\\\\0]*';
/** Zero or more plain folders under `tasks/`. */
const DIRS = `${TASKS_DIR}/(?:${SEG}/)*`;
const NOT_README = '(?![Rr][Ee][Aa][Dd][Mm][Ee]\\.md$)';
const sys = (kind: string, name: string) => new RegExp(`^${DIRS}\\${SYSTEM}/${kind}/${name}\\.md$`);

/** A project file at any depth. Dot names are hidden (`list` skips them, so every adapter must agree). */
export const TASK_PATH = new RegExp(`^${DIRS}${SEG}\\.md$`);
/** Agent result logs. @req FR:ai-triage-assist/result.path */
export const LOG_PATH = sys('logs', `${NOT_README}[A-Za-z0-9][A-Za-z0-9._-]*`);
/** Owner-to-agent inboxes: same name rules as logs. @req FR:agent-inbox/inbox.path */
export const INBOX_PATH = sys('inbox', `${NOT_README}[A-Za-z0-9][A-Za-z0-9._-]*`);
/** Wake files for agents whose asks were answered. @req FR:ask-queue/wake.path */
export const WAKE_PATH = sys('wake', `${NOT_README}[a-z0-9][a-z0-9._-]{0,79}`);
/** Agent asks for the owner, one file per ask. @req FR:ask-queue/ask.path */
export const ASK_PATH = sys('asks', `${NOT_README}[a-z0-9][a-z0-9._-]{0,79}`);
/** Archived (done) asks, one folder down. @req FR:ask-queue/ask.archive */
export const ARCHIVE_PATH = sys('asks/archive', '[a-z0-9][a-z0-9._-]{0,79}');
/** Agent definitions. @req FR:agent-team/agent.path */
export const AGENT_PATH = sys('agents', `${NOT_README}[a-z0-9][a-z0-9._-]{0,39}`);

/** A project ID: one or more plain segments joined by `/`, no `:` (refs use it as the separator). @req FR:task-structure/id.ref */
export const PROJECT_ID = '(?:[^/\\\\:\\0.][^/\\\\:\\0]*/)*[^/\\\\:\\0.][^/\\\\:\\0]*';

/** `tasks/a/b.md` → `a/b`. @req FR:task-structure/id.project */
export const projectId = (path: string): string => path.replace(/^tasks\//, '').replace(/\.md$/, '');
/** `a/b` → `tasks/a/b.md`. */
export const projectPath = (id: string): string => `${TASKS_DIR}/${id}.md`;
/** The last segment without `.md`. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
/** A `README.md` at any level is never a project. @req FR:task-structure/tree.readme */
export const isReadme = (path: string): boolean => /^readme$/i.test(baseName(path));
/** The `.stack` folder beside a project file. @req FR:task-structure/system.beside */
export const systemDir = (path: string): string => `${path.slice(0, path.lastIndexOf('/'))}/${SYSTEM}`;

/** A storage-safe log and inbox name for a project file (its base name). */
export const logName = (path: string): string => {
  const slug = baseName(path).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return /^readme$/i.test(slug) || slug === '' ? 'project' : slug;
};
/** Result log `n` (0 is the newest) of a project, beside it. @req FR:task-structure/system.beside */
export const logFile = (path: string, n: number): string => `${systemDir(path)}/logs/${logName(path)}${n === 0 ? '' : `.${n + 1}`}.md`;
/** The inbox of a project, beside it. @req FR:task-structure/system.beside */
export const inboxFile = (path: string): string => `${systemDir(path)}/inbox/${logName(path)}.md`;
