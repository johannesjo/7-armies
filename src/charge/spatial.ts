/** Uniform-grid spatial hash for fast neighbor queries. Rebuilt every step. */
export class SpatialGrid<T extends { x: number; y: number }> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: T[][];
  /** Indices of non-empty cells, so clearing touches only those. */
  private readonly used: number[] = [];

  constructor(width: number, height: number, private readonly cell: number) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
  }

  private cx(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
  }

  private cy(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
  }

  insert(item: T): void {
    const i = this.cy(item.y) * this.cols + this.cx(item.x);
    const cell = this.cells[i];
    if (cell.length === 0) this.used.push(i);
    cell.push(item);
  }

  /** Collect items whose cell overlaps the query circle's bounding box (caller filters by distance). */
  query(x: number, y: number, r: number, out: T[]): T[] {
    out.length = 0;
    const x0 = this.cx(x - r), x1 = this.cx(x + r);
    const y0 = this.cy(y - r), y1 = this.cy(y + r);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.cells[gy * this.cols + gx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}
