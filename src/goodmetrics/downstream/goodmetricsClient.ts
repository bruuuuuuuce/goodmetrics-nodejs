import {_Metrics, Dimension} from '../_Metrics';
import {goodmetrics} from 'goodmetrics-generated';
import MetricsClient = goodmetrics.MetricsClient;
import {ChannelCredentials, Interceptor} from '@grpc/grpc-js';
import MetricsRequest = goodmetrics.MetricsRequest;
import {AggregatedBatch} from '../pipeline/aggregator';

interface GoodmetricsClientProps {
  address: string;
}
interface GoodmetricsConnectProps {
  hostname: string;
  port: number;
}

export class GoodmetricsClient {
  private readonly prescientDimensions: Map<string, Dimension>;
  private readonly client: MetricsClient;
  private readonly interceptors: Interceptor[];
  private constructor(props: GoodmetricsClientProps) {
    this.client = new MetricsClient(
      props.address,
      ChannelCredentials.createSsl()
    );
    this.prescientDimensions = new Map<string, Dimension>();
    this.interceptors = [];
  }

  static connect(props: GoodmetricsConnectProps): GoodmetricsClient {
    return new GoodmetricsClient({
      address: `${props.hostname}:${props.port}`,
    });
  }

  async sendMetricsBatch(metrics: _Metrics[]): Promise<void> {
    const request = new MetricsRequest({
      shared_dimensions: this.prescientDimensionsToProto(),
      metrics: this.metricsToGoodmetrics(metrics),
    });

    return await new Promise((resolve, reject) => {
      this.client.SendMetrics(request, {interceptors: this.interceptors}, e => {
        if (!e) {
          resolve();
        } else {
          reject(e);
        }
      });
    });
  }

  async sendPreaggregatedMetrics(
    aggregatedBatch: AggregatedBatch[]
  ): Promise<void> {
    const datums: goodmetrics.Datum[] = [];
    for (const batch of aggregatedBatch) {
      datums.push(...batch.asGoodmetrics());
    }
    const request = new MetricsRequest({
      shared_dimensions: this.prescientDimensionsToProto(),
      metrics: datums,
    });

    return await new Promise((resolve, reject) => {
      this.client.SendMetrics(request, {interceptors: this.interceptors}, e => {
        if (!e) {
          resolve();
        } else {
          reject(e);
        }
      });
    });
  }

  private prescientDimensionsToProto(): Map<string, goodmetrics.Dimension> {
    const dimensionsMap = new Map<string, goodmetrics.Dimension>();
    for (const [key, dimen] of this.prescientDimensions) {
      dimensionsMap.set(key, dimen.asGoodmetricsDimension());
    }
    return new Map();
  }

  private metricsToGoodmetrics(metrics: _Metrics[]): goodmetrics.Datum[] {
    return metrics.map(metric => {
      const dimensionsMap = new Map<string, goodmetrics.Dimension>();
      const measurementsMap = new Map<string, goodmetrics.Measurement>();
      for (const [key, dimen] of metric.metricDimensions) {
        dimensionsMap.set(key, dimen.asGoodmetricsDimension());
      }
      for (const [key, value] of metric.metricMeasurements) {
        const _int = Number.isInteger(value) ? value : undefined;
        if (_int) {
          measurementsMap.set(key, new goodmetrics.Measurement({i64: _int}));
        } else {
          measurementsMap.set(key, new goodmetrics.Measurement({f64: value}));
        }
      }
      for (const [key, value] of metric.metricDistributions) {
        measurementsMap.set(
          key,
          new goodmetrics.Measurement({i64: Math.floor(value)})
        );
      }
      return new goodmetrics.Datum({
        metric: metric.name,
        dimensions: dimensionsMap,
        measurements: measurementsMap,
      });
    });
  }
}
