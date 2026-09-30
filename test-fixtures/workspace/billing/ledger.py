class LedgerEntry:
    """Plain words in docstrings stay out of the vocabulary."""

    def settle_invoice(self, invoice_id, ttl_seconds):
        # Neither do words in comments.
        return invoice_id
