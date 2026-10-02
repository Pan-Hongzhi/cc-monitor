export type AttachState = 'detached' | 'attaching' | 'attached' | 'taken_over' | 'error';
export type SessionStatus = 'busy' | 'idle' | 'unknown';

export interface SessionInfo {
  sessionId: string;
  pid: number;
  cwd: string;
  name: string;
  kind: 'interactive' | 'bg';
  jobId?: string;
  status: SessionStatus;
  startedAt: number;
  attachable: boolean;
}

export interface ChatMessage {
  id: string;
  ts: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text: string;
  tool?: { name: string; summary: string };
}

export type ClientFrame =
  | { t: 'in'; d: string }
  | { t: 'paste'; text: string }
  | { t: 'key'; name: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'active' }
  | { t: 'attach' };

export interface StateFrame {
  t: 'state';
  attach: AttachState;
  reason?: string;
  status: SessionStatus;
  size: { cols: number; rows: number };
  unknownRecords: number;
  attachable: boolean;
}

export type ServerFrame =
  | { t: 'replay'; d: string }
  | { t: 'out'; d: string }
  | StateFrame
  | { t: 'chat'; messages: ChatMessage[] }
  | { t: 'hook'; event: string; data: unknown }
  | { t: 'sessions'; list: SessionInfo[] }
  | { t: 'error'; message: string };

export function encodeB64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

export function decodeB64(b: string): string {
  return Buffer.from(b, 'base64').toString('utf8');
}
