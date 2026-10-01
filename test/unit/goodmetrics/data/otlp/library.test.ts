import {library} from '@src/goodmetrics/data/otlp/library';

describe('library', () => {
  it('identifies this library as the OTLP instrumentation scope', () => {
    expect(library.name).toBe('goodmetrics_nodejs');
  });
});
