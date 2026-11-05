/** Errors raised by the PayPal layer (owner: A). Routes map PayPalError to HTTP 502, PayPalConfigError to 500. */

export class PayPalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayPalConfigError';
  }
}

export class PayPalError extends Error {
  /** HTTP status PayPal answered with, or 0 for a network failure. */
  readonly status: number;
  /** PayPal's error name, e.g. "RESOURCE_NOT_FOUND" or "UNPROCESSABLE_ENTITY". */
  readonly paypalName?: string;
  /** Value of the PayPal-Debug-Id header; quote it when asking PayPal support. */
  readonly debugId?: string;
  readonly details?: unknown;

  constructor(message: string, opts: { status: number; paypalName?: string; debugId?: string; details?: unknown }) {
    super(message);
    this.name = 'PayPalError';
    this.status = opts.status;
    this.paypalName = opts.paypalName;
    this.debugId = opts.debugId;
    this.details = opts.details;
  }
}
