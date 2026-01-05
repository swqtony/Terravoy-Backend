# Pre-ICP IP-Based Plan

Before ICP备案, use ECS IP + ports for both staging and production.

## Ports
- prod backend: http://39.105.212.81:3000
- staging backend: http://39.105.212.81:3100
- prod admin (future): http://39.105.212.81:3001
- staging admin (future): http://39.105.212.81:3101

## Notes
- IM endpoints follow backend base for now.
- No certbot / HTTPS required during IP-based phase.
- Ensure staging service binds to 3100 (distinct from prod 3000).
