// Utilities for persisting and retrieving user match preferences.
// We keep the raw JSON payload as-is to avoid field inference.

export async function fetchPrefsForMatch(pool, leanUserId) {
  const { rows } = await pool.query(
    'select match_preferences from user_preferences where leancloud_user_id = $1 limit 1',
    [leanUserId]
  );
  return rows[0]?.match_preferences || {};
}

export async function upsertPrefsForMatch(pool, leanUserId, prefs) {
  await pool.query(
    `insert into user_preferences(leancloud_user_id, match_preferences)
     values ($1, $2)
     on conflict (leancloud_user_id) do update
       set match_preferences = excluded.match_preferences,
           updated_at = now()`,
    [leanUserId, prefs]
  );
}
