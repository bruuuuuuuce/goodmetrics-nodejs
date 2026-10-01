import {
  DimensionCollection,
  MetricDimension,
  ResourceDimensions,
  _Metrics,
} from '../_Metrics';
import {AggregatedBatch} from '../pipeline/aggregator';
import {library} from '../data/otlp/library';
import {
  otlp_common,
  otlp_metrics,
  otlp_metric_service,
  otlp_resource,
} from 'otlp-generated';
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;
import ResourceMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ResourceMetrics;
import ScopeMetrics = otlp_metrics.opentelemetry.proto.metrics.v1.ScopeMetrics;
import ExportMetricsServiceRequest = otlp_metric_service.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;
import Resource = otlp_resource.opentelemetry.proto.resource.v1.Resource;

interface OtlpRequestEncoderProps {
  resourceDimensions: ResourceDimensions;
  metricDimensions: MetricDimension;
  logRawPayload?: (resourceMetrics: ResourceMetrics) => void;
}

function asOtlpDimensions(dimensions: DimensionCollection): KeyValue[] {
  const keyValues: KeyValue[] = [];
  for (const dimension of dimensions.values()) {
    keyValues.push(dimension.asOtlpKeyValue());
  }
  return keyValues;
}

export class OtlpRequestEncoder {
  private readonly resource: Resource;
  private readonly metricDimensions: KeyValue[];
  private readonly logRawPayload?: (resourceMetrics: ResourceMetrics) => void;

  constructor(props: OtlpRequestEncoderProps) {
    this.resource = new Resource({
      attributes: asOtlpDimensions(props.resourceDimensions),
    });
    this.metricDimensions = asOtlpDimensions(props.metricDimensions);
    this.logRawPayload = props.logRawPayload;
  }

  private applyMetricDimensions(resourceMetrics: ResourceMetrics): void {
    if (this.metricDimensions.length === 0) {
      return;
    }
    const addToPoints = (points: {attributes: KeyValue[]}[]): void => {
      for (const point of points) {
        const attributes = new Map(
          this.metricDimensions.map(attribute => [attribute.key, attribute])
        );
        for (const attribute of point.attributes) {
          attributes.set(attribute.key, attribute);
        }
        point.attributes = Array.from(attributes.values());
      }
    };
    for (const scope of resourceMetrics.scope_metrics) {
      for (const metric of scope.metrics) {
        if (metric.has_gauge) addToPoints(metric.gauge.data_points);
        if (metric.has_sum) addToPoints(metric.sum.data_points);
        if (metric.has_histogram) addToPoints(metric.histogram.data_points);
        if (metric.has_exponential_histogram) {
          addToPoints(metric.exponential_histogram.data_points);
        }
        if (metric.has_summary) addToPoints(metric.summary.data_points);
      }
    }
  }

  unary(batch: _Metrics[]): ExportMetricsServiceRequest {
    const resourceMetrics = new ResourceMetrics({
      scope_metrics: [
        new ScopeMetrics({
          scope: library,
          metrics: batch.flatMap(metrics =>
            metrics.asGoofyOtlpMetricSequence()
          ),
        }),
      ],
      resource: this.resource,
    });
    this.applyMetricDimensions(resourceMetrics);
    this.logRawPayload?.(resourceMetrics);
    return new ExportMetricsServiceRequest({
      resource_metrics: [resourceMetrics],
    });
  }

  preaggregated(batch: AggregatedBatch[]): ExportMetricsServiceRequest {
    const resourceMetrics = new ResourceMetrics({
      resource: this.resource,
      scope_metrics: batch.map(metrics => metrics.asOtlpScopeMetrics()),
    });
    this.applyMetricDimensions(resourceMetrics);
    this.logRawPayload?.(resourceMetrics);
    return new ExportMetricsServiceRequest({
      resource_metrics: [resourceMetrics],
    });
  }
}
