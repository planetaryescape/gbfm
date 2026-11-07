import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  AddEntityLinkInput,
  CreateAlbumInput,
  CreateLabelInput,
  CreatePlaylistInput,
  CreateTrackInput,
  EntityType,
  MusicAffiliationWriteHeaders,
  MusicCreditWriteHeaders,
  MusicPlatform,
  MusicWriteHeaders,
  MusicWriteIntent,
  ResolveMusicEntityInput,
  ResolvedMusicEntityResponse,
  ScrapeEntityLinksResponse,
  ScrapeEntityType,
  UpdateAlbumInput,
  UpdateEntityLinkStatusInput,
  UpdateLabelInput,
  UpdatePlaylistInput,
  UpdateTrackInput,
} from './music'

describe('music API contract', () => {
  it('requires a safe observed revision and UUIDv4 in a complete write intent', () => {
    const valid = { expectedRevision: 7, requestId: 'a9fc2be4-f514-43f4-b2eb-d64cd65c3371' }
    expect(Schema.decodeUnknownSync(MusicWriteIntent)(valid)).toEqual(valid)

    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '7', null]) {
      expect(
        Exit.isFailure(Schema.decodeUnknownExit(MusicWriteIntent)({ ...valid, expectedRevision })),
      ).toBe(true)
    }

    for (const requestId of ['', 'a9fc2be4-f514-13f4-b2eb-d64cd65c3371', undefined]) {
      expect(
        Exit.isFailure(Schema.decodeUnknownExit(MusicWriteIntent)({ ...valid, requestId })),
      ).toBe(true)
    }

    expect(
      Exit.isFailure(Schema.decodeUnknownExit(MusicWriteIntent)({ requestId: valid.requestId })),
    ).toBe(true)
    expect(
      Schema.decodeUnknownSync(MusicWriteIntent)({
        ...valid,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }).expectedRevision,
    ).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('preserves both observed affiliation roots and rejects noncanonical revision headers', () => {
    const headers = {
      'x-gbfm-music-revision': '3',
      'x-gbfm-request-id': 'a9fc2be4-f514-43f4-b2eb-d64cd65c3371',
      'x-gbfm-music-label-revision': '11',
    }

    expect(Schema.decodeUnknownSync(MusicAffiliationWriteHeaders)(headers)).toEqual(headers)
    expect(
      Schema.decodeUnknownSync(MusicCreditWriteHeaders)({
        ...headers,
        'x-gbfm-music-artist-revision': '5',
      })['x-gbfm-music-artist-revision'],
    ).toBe('5')

    for (const value of ['-1', '01', '1e2', '1.0', ' 1', '1\u0000', '9007199254740992']) {
      expect(
        Exit.isFailure(
          Schema.decodeUnknownExit(MusicWriteHeaders)({
            ...headers,
            'x-gbfm-music-revision': value,
          }),
        ),
      ).toBe(true)
      expect(
        Exit.isFailure(
          Schema.decodeUnknownExit(MusicAffiliationWriteHeaders)({
            ...headers,
            'x-gbfm-music-label-revision': value,
          }),
        ),
      ).toBe(true)
    }

    // Transport omission decodes so the handler can give the explicit 428.
    expect(Schema.decodeUnknownSync(MusicWriteHeaders)({})).toEqual({})
  })

  it('retains explicit related revisions alongside browser metadata without accepting duplicates', () => {
    const input = {
      expectedRevision: 8,
      requestId: 'a9fc2be4-f514-43f4-b2eb-d64cd65c3371',
      artistIds: ['a'],
      references: [{ entityType: 'artist', entityId: 'a', expectedRevision: 2 }],
      coverImageUrl: 'https://example.test/cover.jpg',
      publishedAt: null,
    }

    expect(Schema.decodeUnknownSync(UpdateAlbumInput)(input)).toEqual(input)
    expect(
      Exit.isFailure(
        Schema.decodeUnknownExit(UpdateAlbumInput)({
          ...input,
          references: [...input.references, ...input.references],
        }),
      ),
    ).toBe(true)
  })

  // Adversarial review found that a plain Schema.String for title/slug let an
  // empty slug through to the DB (varchar NOT NULL accepts ''), unlike the
  // old Zod schemas' .min(1).
  describe('create schemas reject empty title/slug', () => {
    it('CreateAlbumInput rejects an empty slug', () => {
      const result = Schema.decodeUnknownExit(CreateAlbumInput)({ title: 'x', slug: '' })
      expect(Exit.isFailure(result)).toBe(true)
    })

    it('CreateTrackInput rejects an empty title', () => {
      const result = Schema.decodeUnknownExit(CreateTrackInput)({ title: '', slug: 'x' })
      expect(Exit.isFailure(result)).toBe(true)
    })

    it('CreatePlaylistInput rejects an empty title and slug', () => {
      const result = Schema.decodeUnknownExit(CreatePlaylistInput)({ title: '', slug: '' })
      expect(Exit.isFailure(result)).toBe(true)
    })

    it('CreateLabelInput requires non-empty name and slug', () => {
      const result = Schema.decodeUnknownExit(CreateLabelInput)({ name: '', slug: '', content: '' })
      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  // Same review: the admin edit forms (apps/www's -MusicEntityDetailPage.tsx)
  // submit full form state on every save, not a diff -- an unset field
  // arrives as null, not absent. Schema.optional alone (absent-or-value)
  // rejected that; every optional Update*Input field must also accept null.
  describe('update schemas accept null for unset fields', () => {
    it('UpdateAlbumInput accepts null for coverImageUrl/releaseDate/genres/artistIds', () => {
      const result = Schema.decodeUnknownSync(UpdateAlbumInput)({
        title: 'New Title',
        coverImageUrl: null,
        releaseDate: null,
        genres: null,
        artistIds: null,
      })

      expect(result.coverImageUrl).toBeNull()
      expect(result.releaseDate).toBeNull()
    })

    it('UpdateTrackInput accepts null for coverImageUrl/albumId/trackNumber', () => {
      const result = Schema.decodeUnknownSync(UpdateTrackInput)({
        coverImageUrl: null,
        albumId: null,
        trackNumber: null,
      })

      expect(result.coverImageUrl).toBeNull()
      expect(result.albumId).toBeNull()
    })

    it('UpdatePlaylistInput accepts null for description/curatorId', () => {
      const result = Schema.decodeUnknownSync(UpdatePlaylistInput)({
        description: null,
        curatorId: null,
      })

      expect(result.description).toBeNull()
    })

    it('UpdateLabelInput accepts null for optional editorial fields', () => {
      const result = Schema.decodeUnknownSync(UpdateLabelInput)({
        description: null,
        imageUrl: null,
        bannerImageUrl: null,
        tags: null,
        genres: null,
        publishedAt: null,
      })

      expect(result.publishedAt).toBeNull()
    })
  })

  describe('resolved music entity responses', () => {
    const timestamps = {
      publishedAt: null,
      createdById: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }

    const artist = {
      id: 'artist-1',
      revision: 2,
      name: 'Artist',
      bio: null,
      imageUrl: 'https://cdn.example.com/artist.jpg',
      genres: ['ambient'],
      slug: 'artist',
      ...timestamps,
    }

    const album = {
      id: 'album-1',
      revision: 3,
      title: 'Album',
      artistNames: ['Artist'],
      releaseDate: null,
      coverImageUrl: null,
      genres: [],
      albumType: null,
      slug: 'album',
      ...timestamps,
    }

    const track = {
      id: 'track-1',
      revision: 4,
      title: 'Track',
      artistNames: ['Artist'],
      coverImageUrl: null,
      albumId: null,
      trackNumber: 1,
      slug: 'track',
      ...timestamps,
    }

    const playlist = {
      id: 'playlist-1',
      title: 'Playlist',
      description: null,
      coverImageUrl: null,
      curatorId: null,
      slug: 'playlist',
      spotifyUrl: 'https://open.spotify.com/playlist/playlist-1',
      ...timestamps,
    }

    it('accepts all four correlated variants', () => {
      const variants = [
        { entityType: 'artist', entity: artist, coverImageUrl: artist.imageUrl },
        { entityType: 'album', entity: album, coverImageUrl: album.coverImageUrl },
        { entityType: 'track', entity: track, coverImageUrl: track.coverImageUrl },
        { entityType: 'playlist', entity: playlist, coverImageUrl: playlist.coverImageUrl },
      ] as const

      for (const variant of variants) {
        const result = Schema.decodeUnknownSync(ResolvedMusicEntityResponse)({
          ...variant,
          links: [],
        })

        expect(result.entityType).toBe(variant.entityType)
        expect(result.entity.id).toBe(variant.entity.id)
      }
    })

    it('rejects mismatched entity discriminants', () => {
      const mismatches = [
        { entityType: 'artist', entity: album },
        { entityType: 'album', entity: track },
        { entityType: 'track', entity: playlist },
        { entityType: 'playlist', entity: artist },
      ] as const

      for (const mismatch of mismatches) {
        const result = Schema.decodeUnknownExit(ResolvedMusicEntityResponse)({
          ...mismatch,
          links: [],
          coverImageUrl: null,
        })

        expect(Exit.isFailure(result)).toBe(true)
      }
    })

    it('accepts all four concrete scrape entities and rejects labels', () => {
      for (const entity of [artist, album, track, playlist]) {
        const result = Schema.decodeUnknownSync(ScrapeEntityLinksResponse)({ entity, links: [] })
        expect(result.entity.id).toBe(entity.id)
      }

      const labelResult = Schema.decodeUnknownExit(ScrapeEntityLinksResponse)({
        entity: {
          id: 'label-1',
          revision: 0,
          name: 'Label',
          description: null,
          imageUrl: null,
          bannerImageUrl: null,
          slug: 'label',
          content: '',
          tags: null,
          genres: null,
          ...timestamps,
        },
        links: [],
      })

      expect(Exit.isFailure(labelResult)).toBe(true)
    })
  })

  it('supports labels and Discogs without making labels scrapeable', () => {
    expect(Schema.decodeUnknownSync(EntityType)('label')).toBe('label')
    expect(Schema.decodeUnknownSync(MusicPlatform)('discogs')).toBe('discogs')
    expect(Exit.isFailure(Schema.decodeUnknownExit(ScrapeEntityType)('label'))).toBe(true)
  })

  it('accepts authoring origins while preserving origin-less clients', () => {
    const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh'

    expect(Schema.decodeUnknownSync(ResolveMusicEntityInput)({ url })).toEqual({ url })

    for (const origin of ['editorial', 'tweet', 'reply'] as const) {
      expect(Schema.decodeUnknownSync(ResolveMusicEntityInput)({ url, origin })).toEqual({
        url,
        origin,
      })
    }

    expect(
      Exit.isFailure(Schema.decodeUnknownExit(ResolveMusicEntityInput)({ url, origin: 'manual' })),
    ).toBe(true)
  })

  // Adversarial review on the entity-links PR: AddEntityLinkInput.url must
  // reject non-URL strings (matches the old Zod schema's .url()).
  describe('AddEntityLinkInput', () => {
    it('rejects a non-URL string for url', () => {
      const result = Schema.decodeUnknownExit(AddEntityLinkInput)({
        platform: 'spotify',
        url: 'not-a-url',
      })

      expect(Exit.isFailure(result)).toBe(true)
    })

    it('accepts a real URL', () => {
      const result = Schema.decodeUnknownSync(AddEntityLinkInput)({
        platform: 'spotify',
        url: 'https://open.spotify.com/artist/x',
      })

      expect(result.url).toBe('https://open.spotify.com/artist/x')
    })
  })

  // Same review: metadata must accept null, matching every other
  // Update*Input field -- a plain Schema.optional (absent-or-value)
  // rejected null, which admin tooling could plausibly send.
  describe('UpdateEntityLinkStatusInput', () => {
    it('accepts null for metadata', () => {
      const result = Schema.decodeUnknownSync(UpdateEntityLinkStatusInput)({
        status: 'verified',
        metadata: null,
      })

      expect(result.metadata).toBeNull()
    })
  })
})
