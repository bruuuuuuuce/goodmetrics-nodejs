import {
  BooleanDimension,
  NumberDimension,
  StringDimension,
} from '../../src/goodmetrics/_Metrics';

describe('StringDimension', () => {
  it('converts to an OTLP KeyValue with a string_value', () => {
    const dim = new StringDimension('greeting', 'hello');
    const kv = dim.asOtlpKeyValue();
    expect(kv.key).toBe('greeting');
    expect(kv.value.string_value).toBe('hello');
  });

  it('converts to a goodmetrics Dimension with a string field', () => {
    const dim = new StringDimension('greeting', 'hello');
    const proto = dim.asGoodmetricsDimension();
    expect(proto.string).toBe('hello');
    expect(proto.has_string).toBe(true);
  });
});

describe('NumberDimension', () => {
  it('converts to an OTLP KeyValue with a floored int_value', () => {
    const dim = new NumberDimension('count', 3.7);
    const kv = dim.asOtlpKeyValue();
    expect(kv.value.int_value).toBe(3);
  });

  it('floors non-integer values when converting to a goodmetrics Dimension', () => {
    const dim = new NumberDimension('count', 3.7);
    const proto = dim.asGoodmetricsDimension();
    expect(proto.number).toBe(3);
  });

  it('handles negative values', () => {
    const dim = new NumberDimension('count', -3.2);
    expect(dim.asGoodmetricsDimension().number).toBe(-4);
  });
});

describe('BooleanDimension', () => {
  it('converts to an OTLP KeyValue with a bool_value', () => {
    const dim = new BooleanDimension('enabled', true);
    expect(dim.asOtlpKeyValue().value.bool_value).toBe(true);
  });

  it('converts to a goodmetrics Dimension with a boolean field', () => {
    const dim = new BooleanDimension('enabled', false);
    const proto = dim.asGoodmetricsDimension();
    expect(proto.boolean).toBe(false);
    expect(proto.has_boolean).toBe(true);
  });
});
