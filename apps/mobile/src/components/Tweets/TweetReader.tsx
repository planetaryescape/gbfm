import { useState } from 'react'
import { Text, View } from 'react-native'

import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { useTweetReader } from '@/tweets/useTweetReader'

import { ReaderButton } from './ReaderButton'
import { ReaderHeader } from './ReaderHeader'
import { ReaderOptions } from './ReaderOptions'
import { TweetDetail } from './TweetDetail'
import { TweetsStatus } from './TweetsStatus'
import { TweetSwipeSurface } from './TweetSwipeSurface'

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

  const feedback = {
    loading: 'Opening next tweet…',
    error: "Couldn't open that tweet. Your current post is still here.",
    ready: reader.notice ?? "Couldn't save reading progress.",
    empty: null,
  }[reader.status]

  const retryLabel = reader.progressFailed ? 'Retry reading progress' : 'Reading options'

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
          <ReaderHeader
            date={screen.post.createdAt}
            navigationStatus={reader.navigationStatus}
            onOptions={() => setOptions(true)}
          />
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
                go(target, direction)
              }
            }}>
            <TweetDetail
              key={screen.post.id}
              post={screen.post}
              parent={screen.post.parentPostId ? screen.root : null}
              quote={screen.quote}
              replies={screen.replies}
            />
          </TweetSwipeSurface>
          {reader.status === 'loading' ||
          reader.status === 'error' ||
          reader.progressFailed ||
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
                    reader.status === 'error' || reader.progressFailed
                      ? reader.retry
                      : () => setOptions(true)
                  }
                />
              ) : null}
            </View>
          ) : null}
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
          setOptions(false)
          reader.random()
        }}
        onReset={() => {
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
