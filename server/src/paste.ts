export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

export const KEY_SEQUENCES: Record<string, string> = {
  esc: '\x1b',
  'ctrl-c': '\x03',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
};

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function composePaste(text: string): string {
  return PASTE_START + normalizeNewlines(text) + PASTE_END;
}

export function keyToSequence(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(KEY_SEQUENCES, name) ? KEY_SEQUENCES[name] : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendPaste(
  write: (s: string) => void,
  text: string,
  delayMs = 50,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  write(composePaste(text));
  await sleep(delayMs);
  write('\r');
}
