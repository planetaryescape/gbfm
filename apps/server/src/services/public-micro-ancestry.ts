import { type SQL, sql } from 'drizzle-orm'

// Policy references are local to the query's p alias. The caller's ID expression
// is resolved separately before entering that scope. No actor/draft override.
const visibleMicro = sql`p.type = 'micro' AND p.draft = 0 AND NOT EXISTS (
  SELECT 1 FROM post_creators pc JOIN user u ON u.id = pc.creatorId
  WHERE pc.postId = p.id AND u.banned = 1
)`

/**
 * Composable SELECT yielding zero or one {id,parentPostId,rootPostId,depth} row.
 * Depth is computed from the actual public ancestor chain, not posts.depth.
 * Every non-root must name the actual parentless root; root.root_post_id is null.
 * Hidden, malformed, cyclic or >8-edge paths yield zero rows. A ninth-edge
 * sentinel makes overflow fail closed; recursion never walks an unbounded chain.
 * SQL expressions allow a caller's lookup and this projection to share one read
 * snapshot. Strings are bound parameters, not SQL identifiers or raw fragments.
 * The alias-free distance -1 input row resolves caller expressions before any
 * local table scope; only validated distance 0..8 rows can be focus/root output.
 * A preflight result never authorizes a later write: use the predicate below in
 * the same INSERT statement. No body, renderer, provider or mutation is invoked.
 */
export const publicMicroAncestorQuery = (postId: string | SQL): SQL => sql`
  WITH RECURSIVE ancestor_chain(id, parent_post_id, root_post_id, distance) AS (
    SELECT ${postId}, NULL, NULL, -1
    UNION ALL
    SELECT p.id, p.parent_post_id, p.root_post_id, a.distance + 1
    FROM posts p JOIN ancestor_chain a
      ON p.id = CASE WHEN a.distance = -1 THEN a.id ELSE a.parent_post_id END
    WHERE a.distance < 9 AND ${visibleMicro}
  )
  SELECT focus.id, focus.parent_post_id AS parentPostId,
    focus.root_post_id AS rootPostId, root.distance AS depth
  FROM ancestor_chain focus CROSS JOIN ancestor_chain root
  WHERE focus.distance = 0 AND root.parent_post_id IS NULL
    AND root.root_post_id IS NULL AND root.distance BETWEEN 0 AND 8
    AND NOT EXISTS (
      SELECT 1 FROM ancestor_chain path
      WHERE path.distance > 8
        OR (path.parent_post_id IS NOT NULL AND path.root_post_id IS NOT root.id)
    )
`

/**
 * Anonymous reply-parent admission inside INSERT...SELECT/WHERE, not preflight.
 * Fences the expected canonical root and computed depth in the write snapshot.
 * The query permits depth8 for reads; this predicate requires parent.depth<8
 * so an admitted reply cannot create depth9. Derive the child's depth from this
 * guarded projection, or fence any denormalized depth field used by the writer.
 * Caller scope/role, version/receipt and other write guards remain mandatory.
 */
export const publicMicroAncestorPredicate = (expected: {
  postId: string
  rootId: string
  depth: number
}): SQL => sql`EXISTS (
  SELECT 1 FROM (${publicMicroAncestorQuery(expected.postId)}) parent
  WHERE coalesce(parent.rootPostId, parent.id) = ${expected.rootId}
    AND parent.depth = ${expected.depth} AND parent.depth < 8
)`
