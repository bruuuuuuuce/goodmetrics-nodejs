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
| [`grafana-cloud.ts`](./grafana-cloud.ts) | Short-lived process sending OTLP/HTTP Protobuf metrics directly to Grafana Cloud. |
| [`server-batched-otlp.ts`](./server-batched-otlp.ts) | Long-running process buffering/batching metrics over OTLP in the background instead of sending per-call. |
| [`goodmetrics-server.ts`](./goodmetrics-server.ts) | Long-running process using the bespoke `goodmetrics` protocol against a local goodmetrics server, instead of OTLP. |

These are type-checked and compiled as part of `npm run build` (see `tsconfig.json`), so they're
kept in sync with the library's API, but they aren't executed in CI - most require a real
downstream (Lightstep, an OTLP collector, or a goodmetrics server) to actually send metrics.

## Direct cloud intake

These examples require Node.js 22 or newer. Set the endpoint and credentials for your own
Datadog site or Grafana Cloud stack before running them. Both endpoint URLs must end in
`/v1/metrics`; the library sends binary OTLP Protobuf over HTTP and does not append this path.

```bash
DD_API_KEY=<api-key> \
DATADOG_OTLP_METRICS_ENDPOINT=https://otlp.datadoghq.com/v1/metrics \
  npx ts-node --prefer-ts-exts examples/datadog-cloud.ts
```

The Datadog URL above is for US1. Choose your site's URL from the
[Datadog OTLP metrics intake documentation](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/metrics/).
Datadog direct intake accepts delta metrics; the library's OTLP histograms and sums use delta
temporality. Datadog limits compressed metric requests to 512 KiB. For a long-running process,
reduce `unaryBatchSizeMaxMetricsCount` and `preaggregatedBatchMaxMetricsCount` if requests hit
that limit.

```bash
GRAFANA_CLOUD_OTLP_METRICS_ENDPOINT=https://<your-otlp-endpoint>/otlp/v1/metrics \
GRAFANA_CLOUD_OTLP_INSTANCE_ID=<instance-id> \
GRAFANA_CLOUD_ACCESS_POLICY_TOKEN=<token> \
  npx ts-node --prefer-ts-exts examples/grafana-cloud.ts
```

Get the endpoint, instance ID, and access policy token from your Grafana Cloud stack's
OpenTelemetry connection details. The helper sends Basic authorization using the instance ID
and token, as described in [Grafana Cloud's direct OTLP instructions](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/get-started/grafana-cloud/).

Use `MetricsSetups.datadogOtlpHttp` or `MetricsSetups.grafanaCloudOtlpHttp` for a long-running
process; they return the same unary and preaggregated factories as `lightstepNativeOtlp`.
`MetricsSetups.otlpHttp` and `MetricsSetups.otlpHttpForLambda` accept a complete URL and custom
headers for other OTLP/HTTP metrics destinations.
When configured, `metricDimensions` are added to every OTLP data point; a dimension recorded on
an individual metric takes precedence if its name matches a shared dimension. Preaggregated
metrics group records by these effective dimensions.

The existing generic and Lightstep examples use OTLP/gRPC. They target an Agent, Alloy, or
collector receiver; the direct Datadog and Grafana Cloud gateways use OTLP/HTTP.
