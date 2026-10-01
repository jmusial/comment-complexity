// Copyright (c) Example Corp. Licensed under the MIT License.

package shipping

// ParcelWeight returns the parcel weight in grams, rounded up to the next whole gram.
func ParcelWeight(grams float64) int {
	return int(grams + 0.999)
}

// GetCarrier gets the carrier.
func GetCarrier(code string) string {
	return code
}

// Idempotent SQS reconciliation never retries unless the lease wasn't renewed by the DLQ.
var reconcile = func() {}

// TODO later

// legacy := reconcile()
