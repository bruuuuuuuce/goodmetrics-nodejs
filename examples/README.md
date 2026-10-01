# Examples

Runnable usage examples, one per supported setup. Each is a standalone script; run it with:

```bash
npx ts-node --prefer-ts-exts examples/<file>.ts
```

See each file's header comment for required environment variables/backends.

| File | Shows |
| --- | --- |
| [`lambda-lightstep.ts`](./lambda-lightstep.ts) | Short-lived process (e.g. Lambda) sending metrics to Lightstep synchronously on `record()`. |
| [`lambda-generic-otlp.ts`](./lambda-generic-otlp.ts) | Same short-lived-process pattern, pointed at any OTLP backend (e.g. a Datadog Agent's OTLP receiver, or an OpenTelemetry Collector). |
| [`datadog-cloud.ts`](./datadog-cloud.ts) | Short-lived process sending OTLP/HTTP Protobuf metrics directly to Datadog Cloud. |
| [`server-batched-otlp.ts`](./server-batched-otlp.ts) | Long-running process buffering/batching metrics over OTLP in the background instead of sending per-call. |
| [`goodmetrics-server.ts`](./goodmetrics-server.ts) | Long-running process using the bespoke `goodmetrics` protocol against a local goodmetrics server, instead of OTLP. |

These are type-checked and compiled as part of `npm run build` (see `tsconfig.json`), so they're
kept in sync with the library's API, but they aren't executed in CI - most require a real
downstream (Lightstep, an OTLP collector, or a goodmetrics server) to actually send metrics.

## Direct OTLP/HTTP intake

`MetricsSetups.otlpHttp` and `MetricsSetups.otlpHttpForLambda` send binary OTLP Protobuf to a
complete HTTP or HTTPS metrics URL ending in `/v1/metrics`. Supply any required authentication
headers yourself. The existing generic and Lightstep examples use OTLP/gRPC against an Agent or
collector receiver.

For direct Datadog Cloud intake, set the endpoint for your Datadog site and an API key:

```bash
DD_API_KEY=<api-key> \
DATADOG_OTLP_METRICS_ENDPOINT=https://otlp.datadoghq.com/v1/metrics \
  npx ts-node --prefer-ts-exts examples/datadog-cloud.ts
```

The URL above is for US1. Choose your site's URL from the
[Datadog OTLP metrics intake documentation](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/metrics/).
Datadog direct intake accepts delta metrics; the library's OTLP histograms and sums use delta
temporality. Datadog limits compressed metric requests to 512 KiB. For a long-running process,
reduce `unaryBatchSizeMaxMetricsCount` and `preaggregatedBatchMaxMetricsCount` if requests hit
that limit. Use `MetricsSetups.datadogOtlpHttp` for a long-running process or
`MetricsSetups.datadogOtlpHttpForLambda` for a short-lived process.

When configured, `metricDimensions` are added to every OTLP data point; a dimension recorded on
an individual metric takes precedence if its name matches a shared dimension. Preaggregated
metrics group records by these effective dimensions.
