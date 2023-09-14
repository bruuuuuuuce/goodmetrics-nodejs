export abstract class Aggregation {
  abstract accumulate(value: number): void;
}
