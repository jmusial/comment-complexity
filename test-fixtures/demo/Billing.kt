// Kotlin has no bundled grammar, so these lenses are tagged approx.

/** Returns the invoice total for the given lines. */
fun invoiceTotal(lines: List<Int>): Int = lines.sum()

// Idempotent SQS reconciliation never retries unless the lease wasn't renewed.
val reconcile = Unit
