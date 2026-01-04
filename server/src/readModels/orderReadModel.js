function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function maskId(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 4) return text;
  return `user_${text.slice(-4)}`;
}

function pickName({ explicit, nickname, userId, profileId }) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  if (nickname && String(nickname).trim()) return String(nickname).trim();
  if (userId && String(userId).trim()) return maskId(userId);
  if (profileId && String(profileId).trim()) return maskId(profileId);
  return '';
}

export function toOrderReadModel(row) {
  const amount = toNumber(row.total_amount) ?? 0;
  const tags = Array.isArray(row.tags)
    ? row.tags
    : row.tags && typeof row.tags === 'object'
      ? row.tags
      : [];
  return {
    id: row.id?.toString() ?? '',
    order_no: row.order_no ?? '',
    status: row.status ?? '',
    created_at: toIso(row.created_at),
    start_time: toIso(row.start_time),
    people_count: row.people_count ?? 1,
    total_amount: amount,
    currency: row.currency ?? 'CNY',
    experience_id: row.experience_id ?? '',
    experience_title: row.experience_title ?? '',
    experience_cover: row.experience_cover ?? '',
    city: row.city ?? '',
    meeting_point: row.meeting_point ?? '',
    traveler_id: row.traveler_id ?? null,
    host_id: row.host_id ?? null,
    traveler_name: pickName({
      explicit: row.traveler_name,
      nickname: row.traveler_nickname,
      userId: row.travelerUserId,
      profileId: row.traveler_id,
    }),
    traveler_avatar: row.traveler_avatar ?? '',
    host_name: pickName({
      explicit: row.host_name,
      nickname: row.host_nickname,
      userId: row.hostUserId,
      profileId: row.host_id,
    }),
    host_avatar: row.host_avatar ?? '',
    conversation_id: row.conversation_id ?? null,
    payment_status: row.payment_status ?? null,
    payment_method: row.payment_method ?? row.payment_provider ?? null,
    payment_intent_id: row.payment_intent_id ?? null,
    paid_at: toIso(row.paid_at),
    traveler_reviewed: Boolean(row.traveler_reviewed),
    host_reviewed: Boolean(row.host_reviewed),
    review_visible: Boolean(row.review_visible),
    review_reveal_at: toIso(row.review_reveal_at),
    language: row.language_preference ?? row.language ?? '',
    tags,
    time_slot_label: row.time_slot_label ?? null,
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
    visible_to_traveler:
      typeof row.visible_to_traveler === 'boolean'
        ? row.visible_to_traveler
        : true,
    visible_to_host:
      typeof row.visible_to_host === 'boolean' ? row.visible_to_host : true,
    traveler_note: row.traveler_note ?? null,
    contact_phone: row.contact_phone ?? null,
    channel: row.channel ?? 'backend',
    refund_status: row.refund_status ?? null,
    refund_id: row.refund_id ?? null,
    refund_at: toIso(row.refund_at),
    hostUserId: row.hostUserId ?? null,
    travelerUserId: row.travelerUserId ?? null,
  };
}
