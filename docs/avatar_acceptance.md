# Avatar/Nickname Acceptance Checklist

## Backend
1) Orders API response includes hostLeancloudUserId and travelerLeancloudUserId.
2) Match responses never return a null peerLeancloudUserId; if missing, return status=profile_incomplete with errorCode=PEER_LEANCLOUD_ID_MISSING.
3) Profile bootstrap/update rejects missing leancloudUserId with 400.

## Frontend
1) Order-driven chat entry passes peerLeancloudUserId into ChatArgs.otherLeancloudUserId.
2) UserAvatar uses leancloud_user_id for profile lookup; fallbacks show icon/text when missing.
3) Missing peerLeancloudUserId triggers UI notice (no silent failure).
