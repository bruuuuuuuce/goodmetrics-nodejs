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

When configured, `metricDimensions` are added to every OTLP data point; a dimension recorded on
an individual metric takes precedence if its name matches a shared dimension. Preaggregated
metrics group records by these effective dimensions.
