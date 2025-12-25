# Backend ID Mapping

## Purpose
Profiles use a UUID (profileId) for database relations, but chat/avatar display requires the LeanCloud user id. The LeanCloud user id is the external identity shared with IM and display layers, while the profile UUID is internal to Supabase.

## ID Types
- profileId (UUID): Internal database primary key for profiles and orders.
- leancloud_user_id (text): External identity used by IM, public profile lookup, and avatar display.

## Rules
- profiles.leancloud_user_id is required and must be non-empty.
- Any API that creates/ensures profiles must pass a leancloud_user_id.
- Orders keep host_id/traveler_id as profile UUIDs, and responses include:
  - hostLeancloudUserId
  - travelerLeancloudUserId

## Usage Guidance
- IM and avatar lookups always use leancloud_user_id.
- Business logic and authorization use profileId/UUIDs.
