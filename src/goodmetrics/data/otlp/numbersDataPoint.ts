import {otlp_common, otlp_metrics} from 'otlp-generated';
import NumberDataPoint = otlp_metrics.opentelemetry.proto.metrics.v1.NumberDataPoint;
import KeyValue = otlp_common.opentelemetry.proto.common.v1.KeyValue;

export function newNumberDataPoint(
  value: number,
  timestampMillis: number,
  aggregationWidthMillis: number,
  dimensions: KeyValue[]
): NumberDataPoint {
  const _int = Number.isInteger(value) ? value : undefined;
  if (_int) {
    return new NumberDataPoint({
      time_unix_nano: timestampMillis * 1000 * 1000,
      start_time_unix_nano:
        (timestampMillis - aggregationWidthMillis) * 1000 * 1000,
      attributes: dimensions,
      // todo how do determine if is int or double???
      as_int: _int,
    });
  }

  return new NumberDataPoint({
    time_unix_nano: timestampMillis * 1000 * 1000,
    start_time_unix_nano:
      (timestampMillis - aggregationWidthMillis) * 1000 * 1000,
    attributes: dimensions,
    // todo how do determine if is int or double???
    as_double: value,
  });
}
