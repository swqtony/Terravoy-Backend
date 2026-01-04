-- Simple KYC verification field
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS kyc_verified boolean NOT NULL DEFAULT false;
