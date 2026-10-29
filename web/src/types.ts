/** Api shapes the client uses. Kept here so the client never imports from `src/`. */
export interface Task { ref: string; text: string; project: string; section: string; done: boolean; depth: number; notes: string[] }
export interface Project { name: string; title: string; open: number; done: number; metadata: Record<string, string> }
export interface NextTask { ref: string; text: string; project: string; score: number }
export interface Mutation { changed: boolean; ref?: string; before?: string; after?: string; message?: string }
export interface CaptureSpec { title: string; due?: string; effort?: { minutes: number; emoji: string }; project?: string; recurrence?: unknown }
export interface CaptureResult extends Mutation { spec: CaptureSpec }
export type AgentState = 'failing' | 'waiting' | 'review' | 'merged' | 'ci' | 'working' | 'queued';
export interface Pr { url: string; repo: string; number: number; state?: 'open' | 'draft' | 'merged' | 'closed'; checks?: 'passing' | 'failing' | 'pending' | 'none'; title?: string; updatedAt?: string }
export interface Agent { ref: string; project: string; title: string; text: string; state: AgentState; prs: Pr[]; last?: { at: string; action: string; outcome?: string; summary?: string }; waitingOn?: string; replies: number; since?: string }
export interface InboxItem { id: string; at: string; project: string; ref: string; task: string; kind: 'reply' | 'decision'; to: 'agent' | 'human' | 'none'; text: string; state: 'open' | 'handled'; /** Where the row is now (the server follows moved rows). */ row?: string }
export type View = 'asks' | 'today' | 'now' | 'projects' | 'list';
export type Position = 'before' | 'after';
export type ActionName = 'start' | 'complete' | 'skip' | 'resume' | 'suspend';
export interface SetProps { status?: string; priority?: string; effort?: string; impact?: string; checkbox?: 'Complete' | 'Incomplete' }
