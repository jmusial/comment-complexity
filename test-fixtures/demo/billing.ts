/** Returns the invoice total. */
export function invoiceTotal(lines: number[]): number {
  return lines.reduce((sum, line) => sum + line, 0);
}

/** Gets the user. */
export function getUser(id: string): string {
  return id;
}

// Retries the upload when the network drops.
const retries = 3;

// Idempotent DLQ reconciliation isn't never retried unless it wasn't.
const reconcile = (): void => {};

/**
 * Settles every open invoice in the ledger, which is only safe after the nightly export has
 * finished, because settling rewrites the totals that the export reads, and an export that runs
 * concurrently would otherwise capture half-settled balances that no subsequent reconciliation
 * pass is guaranteed to notice before the statements are generated and sent to customers.
 */
export function settleAll(): void {}

// This is slow.
const cache = new Map<string, number>();

export { cache, reconcile, retries };
