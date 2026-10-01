// Copyright (c) Example Corp. Licensed under the MIT License.

package shipping

import "math"

// ParcelWeight returns the parcel weight in grams, rounded up to the next whole gram.
func ParcelWeight(grams float64) int {
	return int(math.Ceil(grams))
}

// GetCarrier gets the carrier.
func GetCarrier(code string) string {
	return code
}

// Idempotent SQS reconciliation never retries unless the lease wasn't renewed by the DLQ.
var reconcile = func() {}

// TODO later

// legacy := reconcile()
