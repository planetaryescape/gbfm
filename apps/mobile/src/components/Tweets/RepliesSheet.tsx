import { Data, Effect, Exit } from 'effect'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { FlatList, Text, View } from 'react-native'

import { getTweetScreen, type TweetScreenPost } from '@/api/tweets'
import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'
import { useThemeColors } from '@/theme/colors'
import { fonts } from '@/theme/fonts'
import { replyCountLabel } from '@/tweets/tweetText'

import { ReplyBar } from './ReplyBar'
import { TweetRow } from './TweetRow'
import { TweetsStatus } from './TweetsStatus'

type RepliesState =
  | { readonly _tag: 'Loading' }
  | { readonly _tag: 'Failed' }
  | { readonly _tag: 'Ready'; readonly replies: ReadonlyArray<TweetScreenPost> }

const RepliesState = Data.taggedEnum<RepliesState>()

const initialState = RepliesState.Loading()

export function RepliesSheet({ slug }: { readonly slug: string }) {
  const [attempt, setAttempt] = useState(0)

  return <Replies key={attempt} slug={slug} onRetry={() => setAttempt((value) => value + 1)} />
}

function Replies({ slug, onRetry }: { readonly slug: string; readonly onRetry: () => void }) {
  const colors = useThemeColors()
  const router = useRouter()
  const user = useAuthStore((auth) => auth.user)
  const [state, setState] = useState<RepliesState>(initialState)

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController()

      void Effect.runPromiseExit(getTweetScreen(slug).pipe(Effect.timeout('15 seconds')), {
        signal: controller.signal,
      }).then((exit) => {
        if (controller.signal.aborted) return
        setState(
          Exit.isSuccess(exit)
            ? RepliesState.Ready({ replies: exit.value.replies })
            : (current) => (RepliesState.$is('Ready')(current) ? current : RepliesState.Failed()),
        )
      })

      return () => controller.abort()
    }, [slug]),
  )

  const reply = () => {
    void haptics.tap()
    router.push(user ? { pathname: '/compose', params: { reply: slug } } : '/sign-in')
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Text
        style={{
          color: colors.strong,
          fontFamily: fonts.monoSemiBold,
          fontSize: 15,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 4,
        }}>
        {RepliesState.$is('Ready')(state) && state.replies.length > 0
          ? replyCountLabel(state.replies.length)
          : 'Replies'}
      </Text>
      {RepliesState.$match(state, {
        Loading: () => <TweetsStatus kind='loading' />,
        Failed: () => (
          <TweetsStatus kind='error' message="couldn't load replies" onRetry={onRetry} />
        ),
        Ready: ({ replies }) => (
          <FlatList
            data={replies}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
            renderItem={({ item }) => <TweetRow tweet={item} />}
            ListEmptyComponent={<TweetsStatus kind='empty' message='no replies yet' />}
          />
        ),
      })}
      <ReplyBar onPress={reply} />
    </View>
  )
}
