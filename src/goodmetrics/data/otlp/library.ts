import {otlp_common} from 'otlp-generated';
import InstrumentationScope = otlp_common.opentelemetry.proto.common.v1.InstrumentationScope;

export const library = new InstrumentationScope({
  name: 'goodmetrics_nodejs',
  version: 'development',
});
