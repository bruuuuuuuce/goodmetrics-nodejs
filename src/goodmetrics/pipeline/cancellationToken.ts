export class CancellationToken {
  private cancelled: boolean;
  public static CANCEL = Symbol('CANCEL');
  private _res: (cancel: symbol) => void;

  constructor() {
    this.cancelled = false;
  }

  public promise = new Promise(res => (this._res = res));

  public cancel() {
    this._res(CancellationToken.CANCEL);
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }
}
