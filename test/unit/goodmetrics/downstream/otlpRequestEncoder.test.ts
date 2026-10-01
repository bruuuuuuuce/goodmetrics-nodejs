import {_Metrics, StringDimension} from '@src/goodmetrics/_Metrics';
import {AggregatedBatch} from '@src/goodmetrics/pipeline/aggregator';
import {StatisticSet} from '@src/goodmetrics/data/StatisticSet';
import {OtlpRequestEncoder} from '@src/goodmetrics/downstream/otlpRequestEncoder';

describe('OtlpRequestEncoder', () => {
  it('builds a unary request with resource attributes and scope metrics', () => {
    const encoder = new OtlpRequestEncoder({
      resourceDimensions: new Map([
        ['env', new StringDimension('env', 'prod')],
      ]),
      metricDimensions: new Map(),
    });
    const metrics = new _Metrics({name: 'orders', timestampMillis: 1000});
    metrics.measure('count', 3);

    const request = encoder.unary([metrics]);

    expect(request.resource_metrics).toHaveLength(1);
    expect(request.resource_metrics[0].resource.attributes[0].key).toBe('env');
    expect(
      request.resource_metrics[0].resource.attributes[0].value.string_value
    ).toBe('prod');
    expect(request.resource_metrics[0].scope_metrics).toHaveLength(1);
    expect(
      request.resource_metrics[0].scope_metrics[0].metrics.map(m => m.name)
    ).toEqual(['orders_count']);
  });

  it('adds shared metric dimensions while preserving record-specific values', () => {
    const encoder = new OtlpRequestEncoder({
      resourceDimensions: new Map(),
      metricDimensions: new Map([
        ['region', new StringDimension('region', 'west')],
        ['service', new StringDimension('service', 'api')],
      ]),
    });
    const metrics = new _Metrics({name: 'orders', timestampMillis: 1000});
    metrics.dimension('region', 'east');
    metrics.measure('count', 1);

    const request = encoder.unary([metrics]);
    const attributes =
      request.resource_metrics[0].scope_metrics[0].metrics[0].gauge
        .data_points[0].attributes;

    expect(
      attributes.map(attribute => [attribute.key, attribute.value.string_value])
    ).toEqual([
      ['region', 'east'],
      ['service', 'api'],
    ]);
  });

  it('adds shared metric dimensions to preaggregated data points', () => {
    const encoder = new OtlpRequestEncoder({
      resourceDimensions: new Map(),
      metricDimensions: new Map([
        ['service', new StringDimension('service', 'api')],
      ]),
    });
    const stats = new StatisticSet();
    stats.accumulate(10);
    const batch = new AggregatedBatch({
      timestampMillis: 1000,
      aggregationWidthMillis: 1000,
      metric: 'orders',
      positions: new Map([
        [
          new Set([new StringDimension('shard', 'a')]),
          new Map([['latency', stats]]),
        ],
      ]),
    });

    const request = encoder.preaggregated([batch]);
    const attributes =
      request.resource_metrics[0].scope_metrics[0].metrics[0].sum.data_points[0]
        .attributes;

    expect(attributes.map(attribute => attribute.key)).toEqual([
      'service',
      'shard',
    ]);
  });
});
