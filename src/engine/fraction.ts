/**
 * Exact rational arithmetic. All algebra validation runs on exact fractions so
 * that "is 25/3 the answer?" is never decided by floating-point rounding.
 */
export class Fraction {
  readonly n: number;
  readonly d: number;

  constructor(n: number, d = 1) {
    if (!Number.isFinite(n) || !Number.isFinite(d)) throw new Error("Non-finite fraction");
    if (d === 0) throw new Error("Division by zero");
    // Accept terminating decimals by scaling to integers.
    let scale = 1;
    while ((!Number.isInteger(n * scale) || !Number.isInteger(d * scale)) && scale < 1e9) scale *= 10;
    let nn = Math.round(n * scale);
    let dd = Math.round(d * scale);
    if (dd < 0) {
      nn = -nn;
      dd = -dd;
    }
    const g = gcd(Math.abs(nn), dd) || 1;
    this.n = nn / g;
    this.d = dd / g;
  }

  static of(v: number | Fraction): Fraction {
    return v instanceof Fraction ? v : new Fraction(v);
  }
  add(o: Fraction | number) {
    const b = Fraction.of(o);
    return new Fraction(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(o: Fraction | number) {
    const b = Fraction.of(o);
    return new Fraction(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(o: Fraction | number) {
    const b = Fraction.of(o);
    return new Fraction(this.n * b.n, this.d * b.d);
  }
  div(o: Fraction | number) {
    const b = Fraction.of(o);
    if (b.n === 0) throw new Error("Division by zero");
    return new Fraction(this.n * b.d, this.d * b.n);
  }
  neg() {
    return new Fraction(-this.n, this.d);
  }
  isZero() {
    return this.n === 0;
  }
  eq(o: Fraction | number) {
    const b = Fraction.of(o);
    return this.n === b.n && this.d === b.d;
  }
  isInteger() {
    return this.d === 1;
  }
  valueOf() {
    return this.n / this.d;
  }
  toString() {
    return this.d === 1 ? `${this.n}` : `${this.n}/${this.d}`;
  }
  toLatex() {
    if (this.d === 1) return `${this.n}`;
    const sign = this.n < 0 ? "-" : "";
    return `${sign}\\frac{${Math.abs(this.n)}}{${this.d}}`;
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
