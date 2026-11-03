import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { useTweetReader } from '@/tweets/useTweetReader'

import { ReaderButton } from './ReaderButton'
import { ReaderOptions } from './ReaderOptions'
import { ReplyBar } from './ReplyBar'
import { TweetDetail } from './TweetDetail'
import { TweetsStatus } from './TweetsStatus'
import { TweetSwipeSurface } from './TweetSwipeSurface'
import { useTweetActions } from './useTweetActions'

function Reader({
  identity,
  sessionToken,
  initialSlug,
}: {
  readonly identity: string
  readonly sessionToken: string | null
  readonly initialSlug: string | undefined
}) {
  const colors = useThemeColors()
  const reader = useTweetReader(identity, sessionToken, initialSlug)
  const [options, setOptions] = useState(false)
  const [entering, setEntering] = useState<'older' | 'newer' | null>(null)
  const { screen, navigation } = reader
  const router = useRouter()
  const user = useAuthStore((auth) => auth.user)

  const openOptions = () => {
    void haptics.select()
    setOptions(true)
  }

  const tweetActions = useTweetActions()

  const showActions = () => {
    if (screen) tweetActions(screen.post, [{ label: 'Reading options', run: openOptions }])
  }

  const reply = () => {
    if (!screen) return
    void haptics.tap()

    if (!user) {
      router.push('/sign-in')

      return
    }

    router.push({ pathname: '/compose', params: { reply: screen.post.slug } })
  }

  const navigationFailed = reader.navigationStatus === 'error' && reader.status === 'ready'

  const feedback = {
    loading: 'Opening next tweet…',
    error: "Couldn't open that tweet. Your current post is still here.",
    ready:
      reader.notice ??
      (reader.progressFailed
        ? "Couldn't save reading progress."
        : "Couldn't load older and newer tweets."),
    empty: null,
  }[reader.status]

  const retryLabel = reader.progressFailed
    ? 'Retry reading progress'
    : navigationFailed
      ? 'Retry'
      : 'Reading options'

  const go = (slug: string | null, direction: 'older' | 'newer' | null = null) => {
    setEntering(direction)
    setOptions(false)
    reader.go(slug)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {reader.status === 'loading' && !screen ? (
        <TweetsStatus kind='loading' />
      ) : reader.status === 'error' && !screen ? (
        <>
          <TweetsStatus kind='error' message="couldn't load this tweet" onRetry={reader.retry} />
          <ReaderButton label='Latest' onPress={() => go(null)} />
        </>
      ) : !screen ? (
        <TweetsStatus kind='empty' message='no tweets yet' />
      ) : (
        <>
          <TweetSwipeSurface
            key={screen.post.slug}
            disabled={options || reader.actionBusy || reader.status !== 'ready' || !navigation}
            pending={reader.status === 'loading'}
            newer={Boolean(navigation?.newer)}
            older={Boolean(navigation?.older)}
            entering={entering}
            onSwipe={(direction) => {
              const target = navigation?.[direction]

              if (target) {
                void haptics.select()
                go(target, direction)
              }
            }}>
            <TweetDetail
              key={screen.post.id}
              post={screen.post}
              parent={screen.post.parentPostId ? screen.root : null}
              quote={screen.quote}
              replies={screen.replies}
              onMore={showActions}
            />
          </TweetSwipeSurface>
          {reader.status === 'loading' ||
          reader.status === 'error' ||
          reader.progressFailed ||
          navigationFailed ||
          reader.notice ? (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
              <Text
                accessibilityLiveRegion='polite'
                style={{ color: colors.strong, fontFamily: fonts.mono, fontSize: 12 }}>
                {feedback}
              </Text>
              {reader.status !== 'loading' ? (
                <ReaderButton
                  label={reader.status === 'error' ? 'Retry tweet' : retryLabel}
                  onPress={
                    reader.status === 'error' || reader.progressFailed || navigationFailed
                      ? reader.retry
                      : openOptions
                  }
                />
              ) : null}
            </View>
          ) : null}
          <ReplyBar onPress={reply} />
        </>
      )}
      <ReaderOptions
        visible={options}
        navigation={navigation}
        onNewer={() => navigation?.newer && go(navigation.newer)}
        onOlder={() => navigation?.older && go(navigation.older)}
        busy={reader.actionBusy}
        failed={reader.navigationStatus === 'error'}
        onClose={() => setOptions(false)}
        onGo={go}
        onRandom={() => {
          setEntering(null)
          setOptions(false)
          reader.random()
        }}
        onReset={() => {
          setEntering(null)
          setOptions(false)
          reader.reset()
        }}
        onRetry={() => {
          setOptions(false)
          reader.retry()
        }}
      />
    </View>
  )
}

export function TweetReader({ initialSlug }: { readonly initialSlug?: string }) {
  const accountId = useAuthStore((auth) => auth.user?.id ?? 'anonymous')
  const sessionToken = useAuthStore((auth) => auth.sessionToken)

  return (
    <Reader
      key={`${accountId}:${initialSlug ?? 'resume'}`}
      identity={accountId}
      sessionToken={sessionToken}
      initialSlug={initialSlug}
    />
  )
}
