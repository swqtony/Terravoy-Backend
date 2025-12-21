export function authorize(actor, action, resource = {}) {
  const deny = (message, status = 403) => {
    const err = new Error(message);
    err.statusCode = status;
    err.code = 'FORBIDDEN';
    throw err;
  };

  switch (action) {
    case 'match:start':
    case 'match:poll':
    case 'match:cancel':
    case 'match:heartbeat':
      if (actor.role !== 'traveler') deny('Traveler role required');
      if (resource.ownerProfileId && resource.ownerProfileId !== actor.profileId) {
        deny('Request does not belong to user');
      }
      break;

    case 'orders:create':
      if (actor.role !== 'traveler') deny('Traveler role required');
      break;

    case 'orders:accept':
    case 'orders:reject':
      if (actor.role !== 'host') deny('Host role required');
      if (resource.hostId && resource.hostId !== actor.profileId) deny('Not order host');
      break;

    case 'orders:cancel':
    case 'orders:review':
      if (actor.role !== 'traveler') deny('Traveler role required');
      if (resource.travelerId && resource.travelerId !== actor.profileId) deny('Not order traveler');
      break;

    case 'orders:start':
    case 'orders:end':
      if (resource.hostId && resource.travelerId) {
        if (actor.profileId !== resource.hostId && actor.profileId !== resource.travelerId) {
          deny('No access to order');
        }
      }
      break;

    case 'orders:detail':
    case 'orders:list:traveler':
    case 'orders:list:host':
      // Ownership enforced by queries; no extra role check.
      break;

    default:
      break;
  }
}
