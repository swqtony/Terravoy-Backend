# Backend ID Mapping

## Purpose
Profiles use a UUID (profileId) for database relations, but chat/avatar display requires an external user id. The external user id is the identity shared with IM and display layers, while the profile UUID is internal to the backend.

## ID Types
- profileId (UUID): Internal database primary key for profiles and orders.
- external_user_id (text): External identity used by IM, public profile lookup, and avatar display.

## Rules
- profiles.external_user_id is required and must be non-empty.
- Any API that creates/ensures profiles must pass an external_user_id.
- Orders keep host_id/traveler_id as profile UUIDs, and responses include:
  - hostExternalUserId
  - travelerExternalUserId

## Usage Guidance
- IM and avatar lookups always use external_user_id.
- Business logic and authorization use profileId/UUIDs.
