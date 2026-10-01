// Copyright (c) Example Corp. Licensed under the MIT License.

/** Returns the parcel weight in grams, rounded up to the next whole gram. */
export function parcelWeight(grams: number): number {
  return Math.ceil(grams);
}

/** Gets the carrier. */
export function getCarrier(code: string): string {
  return code;
}

// Idempotent SQS reconciliation never retries unless the lease wasn't renewed by the DLQ.
const reconcile = (): void => {};

// TODO later

// const legacy = reconcile();

export { reconcile };
