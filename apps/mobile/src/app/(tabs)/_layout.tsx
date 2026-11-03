import { useRouter, useSegments } from 'expo-router'
import { NativeTabs } from 'expo-router/native-tabs'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { MiniPlayerBar } from '@/components/NowPlaying/MiniPlayerBar'
import { haptics } from '@/feedback/haptics'
import { useColorSchemePreference } from '@/store/preferences'
import { useThemeColors } from '@/theme/colors'

import compose from '../../../assets/tabs/compose.png'
import editorial from '../../../assets/tabs/editorial.png'
import listenerSelected from '../../../assets/tabs/listener-selected.png'
import listener from '../../../assets/tabs/listener.png'
import radioSelected from '../../../assets/tabs/radio-selected.png'
import radio from '../../../assets/tabs/radio.png'

const tabIcons = {
  home: { default: radio, selected: radioSelected },
  tweets: { default: editorial, selected: compose },
  profile: { default: listener, selected: listenerSelected },
}

export default function TabsLayout() {
  const colors = useThemeColors()
  useColorSchemePreference()
  const { track } = useNowPlaying()
  const router = useRouter()
  const segments = useSegments()
  const onTweetsRoot = segments.at(-1) === '(tweets)'

  return (
    <NativeTabs
      blurEffect='systemDefault'
      minimizeBehavior='onScrollDown'
      tintColor={colors.tabActive}
      iconColor={{ default: colors.tabInactive, selected: colors.tabActive }}
      labelStyle={{
        default: { color: colors.tabInactive },
        selected: { color: colors.tabActive },
      }}>
      {track ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayerBar />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name='(home)' contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Icon src={tabIcons.home} renderingMode='template' />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name='(tweets)'
        contentStyle={{ backgroundColor: colors.background }}
        listeners={{
          tabPress: () => {
            if (!onTweetsRoot) return
            void haptics.tap()
            router.push('/compose')
          },
        }}>
        <NativeTabs.Trigger.Icon src={tabIcons.tweets} renderingMode='template' />
        <NativeTabs.Trigger.Label>Tweets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='profile' contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Icon src={tabIcons.profile} renderingMode='template' />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
