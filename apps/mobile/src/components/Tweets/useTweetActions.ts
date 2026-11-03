import { hasMinRole } from '@gbfm/core/roles'
import { useRouter } from 'expo-router'
import { ActionSheetIOS, Alert, Platform } from 'react-native'

import type { Tweet } from '@/api/tweets'
import { haptics } from '@/feedback/haptics'
import { useAuthStore } from '@/store/auth'

type Action = { readonly label: string; readonly run: () => void }

export function useTweetActions() {
  const router = useRouter()
  const user = useAuthStore((auth) => auth.user)

  const canEdit = (tweet: Pick<Tweet, 'creators'>) =>
    Boolean(
      user &&
      (hasMinRole(user.role, 'admin') || tweet.creators?.some((creator) => creator.id === user.id)),
    )

  const show = (tweet: Pick<Tweet, 'slug' | 'creators'>, extra: ReadonlyArray<Action> = []) => {
    void haptics.tap()

    const actions: ReadonlyArray<Action> = [
      ...(canEdit(tweet)
        ? [
            {
              label: 'Edit tweet',
              run: () => router.push({ pathname: '/compose', params: { edit: tweet.slug } }),
            },
          ]
        : []),
      ...extra,
    ]

    if (actions.length === 0) return

    if (Platform.OS !== 'ios') {
      Alert.alert('Tweet', undefined, [
        ...actions.map((action) => ({ text: action.label, onPress: action.run })),
        { text: 'Cancel', style: 'cancel' },
      ])

      return
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), 'Cancel'],
        cancelButtonIndex: actions.length,
      },
      (index) => actions[index]?.run(),
    )
  }

  return show
}
