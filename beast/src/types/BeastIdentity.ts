export type IdentityType = "citizen" | "business" | "government" | "dao";

export type IdentityStatus = "active" | "suspended" | "revoked";

export interface BeastIdentity {
  id: string;
  did: string;
  type: IdentityType;
  jurisdiction: string;
  verificationLevel: number;
  status: IdentityStatus;
  reputation: number;
  wallet?: string;
  hash: string;
  createdAt: Date;
  updatedAt: Date;
}

// Stored separately from the shared record. Never enters the ledger or anchors.
export interface IdentityPII {
  identityId: string;
  encryptedName: string;
  encryptedAddress: string;
  encryptedEmail: string;
}
