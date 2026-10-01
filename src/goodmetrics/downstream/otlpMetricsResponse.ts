import {BinaryReader} from 'google-protobuf';
import type {BinaryConstants} from 'google-protobuf';

const WIRE_VARINT = 0 as BinaryConstants.WireType;
const WIRE_LENGTH_DELIMITED = 2 as BinaryConstants.WireType;

interface PartialSuccess {
  rejectedDataPoints: bigint;
  message: string;
}

/** Decode the response fields missing from the pinned otlp-generated package. */
export function decodeMetricsPartialSuccess(
  bytes: Uint8Array
): PartialSuccess | undefined {
  if (bytes.length === 0) {
    return undefined;
  }
  const response = new BinaryReader(bytes);
  let partialSuccess: PartialSuccess | undefined;
  while (response.nextField()) {
    if (response.getFieldNumber() !== 1) {
      response.skipField();
      continue;
    }
    if (response.getWireType() !== WIRE_LENGTH_DELIMITED) {
      throw new Error('Invalid OTLP metrics response');
    }
    const partial = new BinaryReader(response.readBytes());
    let rejectedDataPoints = 0n;
    let message = '';
    while (partial.nextField()) {
      switch (partial.getFieldNumber()) {
        case 1:
          if (partial.getWireType() !== WIRE_VARINT) {
            throw new Error('Invalid OTLP metrics response');
          }
          rejectedDataPoints = BigInt(partial.readInt64String());
          break;
        case 2:
          if (partial.getWireType() !== WIRE_LENGTH_DELIMITED) {
            throw new Error('Invalid OTLP metrics response');
          }
          message = partial.readString();
          break;
        default:
          partial.skipField();
      }
    }
    if (partial.getError()) {
      throw new Error('Invalid OTLP metrics response');
    }
    partialSuccess = {rejectedDataPoints, message};
  }
  if (response.getError()) {
    throw new Error('Invalid OTLP metrics response');
  }
  return partialSuccess;
}
