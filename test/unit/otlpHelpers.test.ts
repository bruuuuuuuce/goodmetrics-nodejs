import {newNumberDataPoint} from '../../src/goodmetrics/data/otlp/numbersDataPoint';
import {library} from '../../src/goodmetrics/data/otlp/library';

describe('newNumberDataPoint()', () => {
  it('encodes integer values as as_int', () => {
    const point = newNumberDataPoint(7, 10_000, 1_000, []);
    expect(point.as_int).toBe(7);
    expect(point.has_as_int).toBe(true);
  });

  it('encodes non-integer values as as_double', () => {
    const point = newNumberDataPoint(3.14, 10_000, 1_000, []);
    expect(point.as_double).toBeCloseTo(3.14);
    expect(point.has_as_double).toBe(true);
  });

  it('computes start_time from timestamp minus the aggregation width', () => {
    const point = newNumberDataPoint(1, 10_000, 1_000, []);
    expect(point.start_time_unix_nano).toBe(9_000 * 1_000 * 1_000);
    expect(point.time_unix_nano).toBe(10_000 * 1_000 * 1_000);
  });

  it('treats a value of exactly 0 as as_double rather than as_int', () => {
    // Known quirk: `Number.isInteger(0) ? 0 : undefined` is `0`, and `if (0)` is falsy,
    // so a zero measurement currently falls through to the as_double branch even though
    // it's an integer. Documenting current behavior here rather than silently masking it.
    const point = newNumberDataPoint(0, 10_000, 1_000, []);
    expect(point.has_as_double).toBe(true);
    expect(point.has_as_int).toBe(false);
  });
});

describe('library', () => {
  it('identifies this library as the OTLP instrumentation scope', () => {
    expect(library.name).toBe('goodmetrics_nodejs');
  });
});
