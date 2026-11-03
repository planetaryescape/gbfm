import { useAtomValue } from '@effect/atom-react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'
import { readReaderPosition } from '@/tweets/readerPosition'
import { useAnchoredFeed } from '@/tweets/useAnchoredFeed'
import { useReaderDiscovery } from '@/tweets/useReaderDiscovery'
import { useReadingProgress } from '@/tweets/useReadingProgress'
import { checkpoints } from '@/tweets/useTweetReader'

import { CaughtUp } from './CaughtUp'
import { ReadingProgress } from './ReadingProgress'
import { TweetPage } from './TweetPage'
import { TweetsStatus } from './TweetsStatus'
import { useTweetActions } from './useTweetActions'

function Pages({
  tweets,
  height,
  startSlug,
  footer,
  onSettle,
  onEndReached,
  onLatest,
}: {
  readonly tweets: ReadonlyArray<Tweet>
  readonly height: number
  readonly startSlug: string | null
  readonly footer: 'end' | 'loading' | 'failed'
  readonly onSettle: (tweet: Tweet) => void
  readonly onEndReached: () => void
  readonly onLatest: () => void
}) {
  const router = useRouter()
  const user = useAuthStore((auth) => auth.user)
  const tweetActions = useTweetActions()

  const [start] = useState(() =>
    Math.max(
      0,
      tweets.findIndex((t) => t.slug === startSlug),
    ),
  )

  const index = useRef(start)

  const settleFirst = useEffectEvent(() => {
    const first = tweets[start]

    if (first) onSettle(first)
  })

  useEffect(() => settleFirst(), [])

  const openReplies = (tweet: Tweet) => {
    void haptics.tap()

    if ((tweet.replyCount ?? 0) > 0)
      router.push({ pathname: '/replies/[slug]', params: { slug: tweet.slug } })
    else if (user) router.push({ pathname: '/compose', params: { reply: tweet.slug } })
    else router.push('/sign-in')
  }

  return (
    <FlatList
      data={tweets}
      keyExtractor={(tweet) => tweet.id}
      pagingEnabled
      decelerationRate='fast'
      showsVerticalScrollIndicator={false}
      initialScrollIndex={start}
      getItemLayout={(_, item) => ({ length: height, offset: height * item, index: item })}
      windowSize={5}
      initialNumToRender={2}
      maxToRenderPerBatch={3}
      onEndReachedThreshold={3}
      onEndReached={onEndReached}
      onMomentumScrollEnd={({ nativeEvent }) => {
        const next = Math.round(nativeEvent.contentOffset.y / height)
        const tweet = tweets[next]

        if (next === index.current || !tweet) return
        index.current = next
        void haptics.select()
        onSettle(tweet)
      }}
      renderItem={({ item }) => (
        <TweetPage
          tweet={item}
          height={height}
          onReplies={() => openReplies(item)}
          onMore={() =>
            tweetActions(item, [
              {
                label: 'Open thread',
                run: () => router.push({ pathname: '/tweet/[slug]', params: { slug: item.slug } }),
              },
            ])
          }
        />
      )}
      ListFooterComponent={
        <CaughtUp height={height} state={footer} onRetry={onEndReached} onTop={onLatest} />
      }
    />
  )
}

export function TweetPager() {
  const identity = useAuthStore((auth) => auth.user?.id ?? 'anonymous')

  return <ReadingSession key={identity} identity={identity} />
}

function ReadingSession({ identity }: { readonly identity: string }) {
  const sessionToken = useAuthStore((auth) => auth.sessionToken)
  const saved = useAtomValue(checkpoints)

  const [target, setTarget] = useState(() => ({
    slug: saved[identity] ?? readReaderPosition(identity),
    revision: 0,
  }))

  const [current, setCurrent] = useState<string | null>(null)
  const [returnSlug, setReturnSlug] = useState<string | null>(null)
  const currentSlug = useRef<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      const stored = readReaderPosition(identity)

      if (stored && currentSlug.current && stored !== currentSlug.current) {
        setTarget((previous) => ({ slug: stored, revision: previous.revision + 1 }))
      }
    }, [identity]),
  )
  const newerUnread = useReaderDiscovery(sessionToken, current)
  const visit = useReadingProgress(identity, sessionToken)

  const go = (slug: string | null) =>
    setTarget((previous) => ({ slug, revision: previous.revision + 1 }))

  const latest = () => {
    setReturnSlug((previous) => previous ?? current)
    go(null)
  }

  return (
    <View style={{ flex: 1 }}>
      <ReadingProgress
        newerUnread={newerUnread}
        canReturn={Boolean(returnSlug)}
        onLatest={latest}
        onReturn={() => {
          if (returnSlug) go(returnSlug)
        }}
      />
      <Feed
        key={target.revision}
        sessionToken={sessionToken}
        startSlug={target.slug}
        onRetry={() => go(target.slug)}
        onLatest={latest}
        onSettle={(tweet) => {
          setCurrent(tweet.slug)
          currentSlug.current = tweet.slug
          setReturnSlug((previous) => (previous === tweet.slug ? null : previous))
          visit(tweet.slug)
        }}
      />
    </View>
  )
}

function Feed({
  sessionToken,
  startSlug,
  onRetry,
  onSettle,
  onLatest,
}: {
  readonly sessionToken: string | null
  readonly startSlug: string | null
  readonly onRetry: () => void
  readonly onSettle: (tweet: Tweet) => void
  readonly onLatest: () => void
}) {
  const feed = useAnchoredFeed(sessionToken, startSlug)
  const [height, setHeight] = useState(0)
  const [displayed, setDisplayed] = useState<string | null>(null)

  if (feed.status === 'loading') return <TweetsStatus kind='loading' />

  if (feed.status === 'error')
    return <TweetsStatus kind='error' message="couldn't load tweets" onRetry={onRetry} />

  if (feed.tweets.length === 0) return <TweetsStatus kind='empty' message='no tweets yet' />

  return (
    <View
      style={{ flex: 1 }}
      onLayout={({ nativeEvent }) => setHeight(Math.round(nativeEvent.layout.height))}>
      {height > 0 ? (
        <Pages
          key={height}
          tweets={feed.tweets}
          height={height}
          startSlug={displayed ?? startSlug}
          footer={feed.loadMoreFailed ? 'failed' : feed.hasMore ? 'loading' : 'end'}
          onSettle={(tweet) => {
            setDisplayed(tweet.slug)
            onSettle(tweet)
          }}
          onEndReached={feed.loadMore}
          onLatest={onLatest}
        />
      ) : null}
    </View>
  )
}
