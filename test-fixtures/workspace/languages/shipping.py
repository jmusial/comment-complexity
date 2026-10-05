# Copyright (c) Example Corp. Licensed under the MIT License.


def parcel_weight(grams):
    """Returns the parcel weight in grams, rounded up to the next whole gram."""
    return -(-grams // 1)


def get_carrier(code):
    """Gets the carrier."""
    return code


# Idempotent SQS reconciliation never retries unless the lease wasn't renewed by the DLQ.
RECONCILE = None

# TODO later

# legacy = reconcile()
