export async function recountPostCommentCount(pool, postId) {
  const { rows } = await pool.query(
    `update discover_posts
     set comment_count = (
       select count(*) from discover_comments
       where post_id = $1 and status = 'published'
     ),
     updated_at = now()
     where id = $1
     returning comment_count`,
    [postId]
  );
  return rows[0]?.comment_count ?? 0;
}
