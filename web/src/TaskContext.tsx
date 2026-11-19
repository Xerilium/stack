/**
 * The top-level row a task sits under, as one muted line: `in Release FTK v16`. Reusable wherever a leaf shows alone.
 * @req FR:now-screen/now.one
 */
import { Md } from './parts';
import './task-context.css';

export function TaskContext({ title, project, id }: { title: string; project?: string; id?: string }) {
  return <p class="task-context" id={id} data-testid="task-context" title={`in ${title}`}>in <Md text={title} links={false} project={project} /></p>;
}
