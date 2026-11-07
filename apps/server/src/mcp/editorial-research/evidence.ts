import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer, Schema } from 'effect'

import { Database } from '@/db/layer'
import { parseMusicSource } from '@/services/canonical-music-identity/music-source'

import { EditorialToolError } from '../contracts'
import {
  EditorialEvidence,
  EvidenceEntity,
  EvidenceRelation,
  ResearchKind,
  type ResearchRef,
  SourceEvidence,
} from './contracts'

export const researchUnavailable = () =>
  new EditorialToolError({
    code: 'unavailable',
    message: 'Music research is unavailable.',
  })

export const researchNotFound = () =>
  new EditorialToolError({
    code: 'not_found',
    message: 'Research source not found.',
  })

const entityTable = (kind: ResearchRef['entityType']) =>
  sql.identifier(
    {
      artist: 'music_artists',
      album: 'music_albums',
      track: 'music_tracks',
      label: 'music_labels',
    }[kind],
  )

/** Strict evidence projection; selected IDs are pushed into each table before any union. */
const entityRows = (kind: ResearchRef['entityType'], now: number, ids?: SQL) => {
  const name = kind === 'artist' || kind === 'label' ? sql`t.name` : sql`t.title`
  const published = kind === 'label' ? sql`t.published_at` : sql`t.publishedAt`
  const updated = kind === 'label' ? sql`t.updated_at` : sql`t.updatedAt`

  return sql`select ${kind} entityType,t.id entityId,substr(${name},1,200) name,
    substr(t.slug,1,200) slug,${published} publishedAt,${updated} updatedAt,
    ${kind === 'track' ? sql`case when a.publishedAt<=${now} then a.id else null end` : sql`null`} albumId,
    ${kind === 'track' ? sql`t.trackNumber` : sql`null`} trackNumber
    from ${entityTable(kind)} t ${kind === 'track' ? sql`left join music_albums a on a.id=t.albumId` : sql``}
    where ${published}<=${now} ${ids ? sql`and t.id in (${ids})` : sql``}`
}

const entities = (now: number, selected?: SQL) =>
  sql.join(
    ResearchKind.literals.map((kind) =>
      entityRows(
        kind,
        now,
        selected ? sql`select entityId from (${selected}) where entityType=${kind}` : undefined,
      ),
    ),
    sql` union all `,
  )

const RefRow = Schema.Struct({
  entityType: EvidenceEntity.fields.entityType,
  entityId: EvidenceEntity.fields.entityId,
})

const RelatedRow = Schema.Struct({
  ...EvidenceEntity.fields,
  kind: EvidenceRelation.fields.kind,
  tier: Schema.Int,
  witnessId: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  position: Schema.NullOr(Schema.Int),
})

const PostRow = Schema.Struct({
  postId: EditorialEvidence.fields.postId,
  title: Schema.NullOr(Schema.String),
  slug: Schema.String,
  updatedAt: EditorialEvidence.fields.updatedAt,
  entityType: RefRow.fields.entityType,
  entityId: EvidenceEntity.fields.entityId,
})

const LinkRow = Schema.Struct({ platform: Schema.String, url: Schema.String })

const makeStore = Effect.gen(function* () {
  const db = yield* Database

  /** Query counter is request-local, including all nested evidence traversals. */
  const open = (now: number) => {
    let statements = 0
    let records = 0

    const query = <A>(statement: SQL, codec: Schema.Codec<A, unknown>) =>
      Effect.gen(function* () {
        statements += 1

        if (statements > 14) return yield* researchUnavailable()

        const rows = yield* Effect.tryPromise({
          try: () => db.all(statement),
          catch: researchUnavailable,
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(codec))),
          Effect.mapError(researchUnavailable),
        )

        records += rows.length

        if (records > 400) return yield* researchUnavailable()

        return rows
      })

    const getEntities = (refs: ReadonlyArray<ResearchRef>) =>
      query(
        sql`
      with e as not materialized (${entities(
        now,
        sql`select json_extract(value,'$.entityType') entityType,
        json_extract(value,'$.entityId') entityId from json_each(${JSON.stringify(refs)})`,
      )})
      select e.* from json_each(${JSON.stringify(refs)}) r join e
      on e.entityType=json_extract(r.value,'$.entityType')
      and e.entityId=json_extract(r.value,'$.entityId') order by cast(r.key as integer)`,
        EvidenceEntity,
      )

    const requireEntity = (ref: ResearchRef) =>
      getEntities([ref]).pipe(
        Effect.flatMap((rows) =>
          rows[0] ? Effect.succeed(rows[0]) : Effect.fail(researchNotFound()),
        ),
      )

    const coverage = (
      refs: ReadonlyArray<ResearchRef>,
      limit = 20,
      primaryOnly = false,
      excludePostId: string | null = null,
    ) =>
      query(
        sql`
      with e as not materialized (${entities(
        now,
        sql`select json_extract(value,'$.entityType') entityType,
        json_extract(value,'$.entityId') entityId from json_each(${JSON.stringify(refs)})`,
      )}), references_for_posts as (
        select x.post_id postId, case when x.album_id is not null then 'album'
          when x.track_id is not null then 'track' else 'playlist' end entityType,
          coalesce(x.album_id,x.track_id,x.playlist_id) entityId, x.is_primary isPrimary
        from post_music_references x
        union all
        select p.id,p.music_entity_type,p.music_entity_id,1 from posts p
        where p.music_references_managed=0 and not exists
          (select 1 from post_music_references x where x.post_id=p.id)
      ), matches as (
        select p.id postId, substr(p.title,1,200) title, substr(p.slug,1,200) slug,
          p.updatedAt, e.entityType,e.entityId,cast(r.key as integer) seedOrder,
          row_number() over(partition by p.id order by cast(r.key as integer)) matchOrder
        from json_each(${JSON.stringify(refs)}) r join e
          on e.entityType=json_extract(r.value,'$.entityType')
          and e.entityId=json_extract(r.value,'$.entityId')
        join references_for_posts x on x.entityType=e.entityType and x.entityId=e.entityId
        join posts p on p.id=x.postId
        where p.draft=0 and p.type='post' and (${excludePostId} is null or p.id<>${excludePostId})
          and (${primaryOnly ? 1 : 0}=0 or x.isPrimary=1)
      ) select postId,title,slug,updatedAt,entityType,entityId from matches
      where (${primaryOnly ? 1 : 0}=0 or matchOrder=1)
      order by seedOrder,postId limit ${limit + 1}`,
        PostRow,
      ).pipe(
        Effect.map((rows) => ({
          rows: rows.slice(0, limit).map((row) =>
            EditorialEvidence.make({
              postId: row.postId,
              title: row.title,
              slug: row.slug,
              updatedAt: row.updatedAt,
              music: { entityType: row.entityType, entityId: row.entityId },
            }),
          ),
          hasMore: rows.length > limit,
        })),
      )

    const sources = (ref: ResearchRef, limit = 20) =>
      query(
        sql`
      select substr(platform,1,100) platform, substr(url,1,2049) url
      from music_entity_links where entity_type=${ref.entityType} and entityId=${ref.entityId}
      and status='verified' order by platform, id limit ${limit + 1}`,
        LinkRow,
      ).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows.slice(0, limit), (row) =>
            parseMusicSource(row.url).pipe(
              Effect.map((source) => [
                SourceEvidence.make({
                  music: ref,
                  platform: row.platform,
                  url: source.canonicalUrl,
                }),
              ]),
              Effect.catchTag('MusicSourceInvalid', () => Effect.succeed([])),
            ),
          ).pipe(Effect.map((parsed) => ({ rows: parsed.flat(), hasMore: rows.length > limit }))),
        ),
      )

    const genre = (genreId: string, limit: number) =>
      query(
        sql`
      with e as not materialized (${entities(
        now,
        sql`select case when entity_type='musicLabel'
        then 'label' else entity_type end entityType,entity_id entityId from entity_labels where label_id=${genreId}`,
      )})
      select e.* from entity_labels x join labels l on l.id=x.label_id and l.kind='genre'
      join e on (case when e.entityType='label' then 'musicLabel' else e.entityType end)=x.entity_type and e.entityId=x.entity_id
      where l.id=${genreId} order by e.entityType,e.entityId limit ${limit + 1}`,
        EvidenceEntity,
      )

    const label = (labelId: string, limit: number) =>
      query(
        sql`
      with refs as (
        select 'artist' entityType, artist_id entityId from music_label_artists where label_id=${labelId}
        union all select 'album', album_id from music_label_albums where label_id=${labelId}),
      e as not materialized (${entities(now, sql`select * from refs`)})
      select e.* from refs join e using(entityType,entityId)
      order by e.entityType,e.entityId limit ${limit + 1}`,
        EvidenceEntity,
      )

    // Branches keep their own seed-edge cap. No inferred names, genres or credits.
    const related = (ref: ResearchRef) => {
      const branches: Array<SQL> = []
      const targetTable = entityTable(ref.entityType)

      const targetPublished =
        ref.entityType === 'label' ? sql`target.published_at` : sql`target.publishedAt`

      if (ref.entityType === 'track')
        branches.push(sql`
        select t.id entityId, 'same_album' kind, 1 tier, s.albumId witnessId,
          null role, null position from music_tracks s join music_albums a on a.id=s.albumId
          join music_tracks t on t.albumId=s.albumId
        where s.id=${ref.entityId} and a.publishedAt<=${now} and t.publishedAt<=${now}
          and t.id<>s.id order by t.id limit 201`)

      if (ref.entityType === 'album' || ref.entityType === 'track') {
        const table =
          ref.entityType === 'album' ? sql`music_album_artists` : sql`music_track_artists`

        const column = ref.entityType === 'album' ? sql`albumId` : sql`trackId`
        branches.push(sql`
          select x.${column} entityId, 'shared_artist' kind, 2 tier, min(s.artistId) witnessId,
            null role, null position from
            (select j.artistId from ${table} j join music_artists a on a.id=j.artistId
             where j.${column}=${ref.entityId} and a.publishedAt<=${now}
             order by j.artistId limit 50) s
          join ${table} x on x.artistId=s.artistId
          join ${targetTable} target on target.id=x.${column} and ${targetPublished}<=${now}
          where x.${column}<>${ref.entityId} group by x.${column}
          order by entityId limit 201`)
      }

      if (ref.entityType === 'artist' || ref.entityType === 'album') {
        const table =
          ref.entityType === 'artist' ? sql`music_label_artists` : sql`music_label_albums`

        const column = ref.entityType === 'artist' ? sql`artist_id` : sql`album_id`
        branches.push(sql`
          select x.${column} entityId, 'shared_music_label' kind, 3 tier, min(s.label_id) witnessId,
            null role, null position from
            (select j.label_id from ${table} j join music_labels l on l.id=j.label_id
             where j.${column}=${ref.entityId} and l.published_at<=${now}
             order by j.label_id limit 50) s
          join ${table} x on x.label_id=s.label_id
          join ${targetTable} target on target.id=x.${column} and ${targetPublished}<=${now}
          where x.${column}<>${ref.entityId} group by x.${column}
          order by entityId limit 201`)
      }

      branches.push(sql`
        select x.entity_id entityId, 'shared_genre' kind, 4 tier, min(s.label_id) witnessId,
          null role, null position from
          (select j.label_id from entity_labels j join labels l on l.id=j.label_id
           where j.entity_type=${ref.entityType === 'label' ? 'musicLabel' : ref.entityType} and j.entity_id=${ref.entityId} and l.kind='genre'
           order by j.label_id limit 50) s join entity_labels x indexed by entity_labels_label_idx on x.label_id=s.label_id
        join ${targetTable} target on target.id=x.entity_id and ${targetPublished}<=${now}
        where x.entity_type=${ref.entityType === 'label' ? 'musicLabel' : ref.entityType} and x.entity_id<>${ref.entityId}
        group by x.entity_id order by entityId limit 201`)

      return query(
        sql`
        with e as not materialized (${entityRows(ref.entityType, now)}), candidates as (
          ${sql.join(
            branches.map((branch) => sql`select * from (${branch})`),
            sql` union all `,
          )}
        ), ranked as (
          select e.*,c.kind,c.tier,c.witnessId,c.role,c.position,
          row_number() over(partition by e.entityId order by c.tier,c.witnessId) rank
          from candidates c join e on e.entityType=${ref.entityType} and e.entityId=c.entityId)
        select entityType,entityId,name,slug,publishedAt,updatedAt,albumId,trackNumber,
          kind,tier,witnessId,role,position from ranked where rank=1
        order by tier,entityId limit 201`,
        RelatedRow,
      )
    }

    const collaborations = (artistId: string, limit: number) =>
      query(
        sql`
      with credits as (
        select 'album' entityType,albumId entityId from music_album_artists where artistId=${artistId}
        union all select 'track',trackId from music_track_artists where artistId=${artistId}),
      e as not materialized (${entities(now, sql`select * from credits`)}),
      seed as (select e.* from credits c join e using(entityType,entityId)
        order by e.entityType,e.entityId limit 50), pairs as (
        select s.entityType,s.entityId,x.artistId,substr(x.role,1,100) role
        from seed s join music_album_artists x on s.entityType='album' and x.albumId=s.entityId
        union all select s.entityType,s.entityId,x.artistId,substr(x.role,1,100)
        from seed s join music_track_artists x on s.entityType='track' and x.trackId=s.entityId)
      select e.*, 'shared_artist' kind, 2 tier, p.entityId witnessId,p.role,null position
      from pairs p join (${entityRows('artist', now)}) e on e.entityId=p.artistId
      where p.artistId<>${artistId} order by p.entityType,p.entityId,p.artistId
      limit ${limit + 1}`,
        RelatedRow,
      )

    const seedEdgesTruncated = (ref: ResearchRef) => {
      const branches: Array<SQL> = [
        sql`
        select j.label_id from entity_labels j join labels l on l.id=j.label_id
        where j.entity_type=${ref.entityType === 'label' ? 'musicLabel' : ref.entityType}
          and j.entity_id=${ref.entityId} and l.kind='genre' order by j.label_id limit 51`,
      ]

      if (ref.entityType === 'album' || ref.entityType === 'track') {
        const table =
          ref.entityType === 'album' ? sql`music_album_artists` : sql`music_track_artists`

        const column = ref.entityType === 'album' ? sql`albumId` : sql`trackId`
        branches.push(sql`select j.artistId from ${table} j join music_artists a on a.id=j.artistId
          where j.${column}=${ref.entityId} and a.publishedAt<=${now} order by j.artistId limit 51`)
      }

      if (ref.entityType === 'artist' || ref.entityType === 'album') {
        const table =
          ref.entityType === 'artist' ? sql`music_label_artists` : sql`music_label_albums`

        const column = ref.entityType === 'artist' ? sql`artist_id` : sql`album_id`
        branches.push(sql`select j.label_id from ${table} j join music_labels l on l.id=j.label_id
          where j.${column}=${ref.entityId} and l.published_at<=${now} order by j.label_id limit 51`)
      }

      return query(
        sql.join(
          branches.map((branch) => sql`select count(*) n from (${branch})`),
          sql` union all `,
        ),
        Schema.Struct({ n: Schema.Int }),
      ).pipe(Effect.map((rows) => rows.some((row) => row.n > 50)))
    }

    return {
      getEntities,
      requireEntity,
      coverage,
      sources,
      genre,
      label,
      related,
      collaborations,
      seedEdgesTruncated,
    }
  }

  return { open }
})

/** Request-bounded read sessions shared by E2 and R2; no registry, provider or writes. */
export class EditorialEvidenceStore extends Context.Service<
  EditorialEvidenceStore,
  Effect.Success<typeof makeStore>
>()('gbfm/mcp/EditorialEvidenceStore') {}

export const EditorialEvidenceStoreLayer = Layer.effect(EditorialEvidenceStore, makeStore)
