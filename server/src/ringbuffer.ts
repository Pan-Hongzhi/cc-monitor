export class RingBuffer {
  private chunks: string[] = [];
  private total = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error('capacity must be positive');
  }

  push(chunk: string): void {
    if (chunk.length === 0) return;
    if (chunk.length >= this.capacity) {
      this.chunks = [chunk.slice(chunk.length - this.capacity)];
      this.total = this.capacity;
      return;
    }
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.capacity) {
      const over = this.total - this.capacity;
      const head = this.chunks[0];
      if (head.length <= over) {
        this.chunks.shift();
        this.total -= head.length;
      } else {
        this.chunks[0] = head.slice(over);
        this.total -= over;
      }
    }
  }

  toString(): string {
    return this.chunks.join('');
  }

  tail(n: number): string {
    const s = this.toString();
    return n >= s.length ? s : s.slice(s.length - n);
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }

  get length(): number {
    return this.total;
  }
}
