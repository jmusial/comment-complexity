// Copyright (c) Example Corp. Licensed under the MIT License.

/// Returns the parcel weight in grams, rounded up to the next whole gram.
pub fn parcel_weight(grams: f64) -> u32 {
    grams.ceil() as u32
}

/// Gets the carrier.
pub fn get_carrier(code: &str) -> &str {
    code
}

// Idempotent SQS reconciliation never retries unless the lease wasn't renewed by the DLQ.
pub const RECONCILE: () = ();

// TODO later

// let legacy = reconcile();
