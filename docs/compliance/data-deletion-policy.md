# Data Deletion Policy

- Deletion requests apply to the PII store and derived non-ledger data.
- The ledger is append-only and never edited or deleted. Because it holds only hashes, deleting the PII (and any salts or keys) makes the corresponding payload hashes unlinkable.
- Process: request received → identity verified → admin approval → PII and encryption keys deleted → deletion event appended to the ledger (via Ledger API) → confirmation to the requester.
- Deletion is subject to legal holds and open appeals.
- Backups containing deleted data expire on the standard backup rotation.
