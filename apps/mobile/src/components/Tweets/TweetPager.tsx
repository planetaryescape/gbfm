import { useAtomValue } from '@effect/atom-react'
import { useRouter } from 'expo-router'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { FlatList, View } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'
import { readReaderPosition } from '@/tweets/readerPosition'
import { useReadingProgress } from '@/tweets/useReadingProgress'
import { useTweetFeed } from '@/tweets/useTweetFeed'
import { checkpoints } from '@/tweets/useTweetReader'

import { CaughtUp } from './CaughtUp'
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
}: {
  readonly tweets: ReadonlyArray<Tweet>
  readonly height: number
  readonly startSlug: string | null
  readonly footer: 'end' | 'loading' | 'failed'
  readonly onSettle: (tweet: Tweet) => void
  readonly onEndReached: () => void
}) {
  const router = useRouter()
  const user = useAuthStore((auth) => auth.user)
  const tweetActions = useTweetActions()
  const list = useRef<FlatList<Tweet>>(null)

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
      ref={list}
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
        <CaughtUp
          height={height}
          state={footer}
          onRetry={onEndReached}
          onTop={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
        />
      }
    />
  )
}

export function TweetPager() {
  const [attempt, setAttempt] = useState(0)
  const identity = useAuthStore((auth) => auth.user?.id ?? 'anonymous')

  return (
    <Feed
      key={`${identity}:${attempt}`}
      identity={identity}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  )
}

const RESUME_LIMIT = 300

function Feed({ identity, onRetry }: { readonly identity: string; readonly onRetry: () => void }) {
  const sessionToken = useAuthStore((auth) => auth.sessionToken)
  const saved = useAtomValue(checkpoints)
  const [startSlug] = useState(() => saved[identity] ?? readReaderPosition(identity))
  const feed = useTweetFeed()
  const visit = useReadingProgress(identity, sessionToken)
  const [height, setHeight] = useState(0)
  const found = !startSlug || feed.tweets.some((tweet) => tweet.slug === startSlug)
  const searching = !found && feed.hasMore && !feed.loadMoreFailed

  useEffect(() => {
    if (searching && feed.tweets.length < RESUME_LIMIT) feed.loadMore()
  }, [searching, feed])

  if (feed.status === 'loading' || (searching && feed.tweets.length < RESUME_LIMIT))
    return <TweetsStatus kind='loading' />

  if (feed.status === 'error')
    return <TweetsStatus kind='error' message="couldn't load tweets" onRetry={onRetry} />

  if (feed.tweets.length === 0) return <TweetsStatus kind='empty' message='no tweets yet' />

  return (
    <View
      style={{ flex: 1 }}
      onLayout={({ nativeEvent }) => setHeight(Math.round(nativeEvent.layout.height))}>
      {height > 0 ? (
        <Pages
          key={`${identity}:${height}`}
          tweets={feed.tweets}
          height={height}
          startSlug={startSlug}
          footer={feed.loadMoreFailed ? 'failed' : feed.hasMore ? 'loading' : 'end'}
          onSettle={(tweet) => visit(tweet.slug)}
          onEndReached={feed.loadMore}
        />
      ) : null}
    </View>
  )
}
