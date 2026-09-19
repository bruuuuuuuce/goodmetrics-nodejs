import {Histogram} from '../../src/goodmetrics/data/Histogram';

describe('Histogram', () => {
  it('counts repeated values into the same bucket', () => {
    const histogram = new Histogram();
    histogram.accumulate(5);
    histogram.accumulate(5);
    histogram.accumulate(5);

    expect(histogram.bucketCounts.get(5)).toBe(3);
  });

  it('tracks distinct values in distinct buckets', () => {
    const histogram = new Histogram();
    histogram.accumulate(5);
    histogram.accumulate(50);

    expect(histogram.bucketCounts.size).toBe(2);
  });

  it('asOtlpHistogram() reports the total accumulated count and a trailing implicit-infinity bucket', () => {
    const histogram = new Histogram();
    histogram.accumulate(5);
    histogram.accumulate(5);
    histogram.accumulate(50);

    const otlp = histogram.asOtlpHistogram({
      dimensions: [],
      timestampMillis: 10_000,
      aggregationWidthMillis: 1_000,
    });

    const dataPoint = otlp.data_points[0];
    expect(dataPoint.count).toBe(3);
    // one extra 0 for OTLP's implicit trailing infinity bucket
    expect(dataPoint.bucket_counts.length).toBeGreaterThan(
      histogram.bucketCounts.size
    );
    expect(dataPoint.bucket_counts[dataPoint.bucket_counts.length - 1]).toBe(0);
  });
});
