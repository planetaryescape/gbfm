import { NativeTabs } from 'expo-router/native-tabs'

import { useNowPlaying } from '@/audio/NowPlayingProvider'
import { MiniPlayerBar } from '@/components/NowPlaying/MiniPlayerBar'
import { useColorSchemePreference } from '@/store/preferences'
import { useThemeColors } from '@/theme/colors'

import editorialSelected from '../../../assets/tabs/editorial-selected.png'
import editorial from '../../../assets/tabs/editorial.png'
import listenerSelected from '../../../assets/tabs/listener-selected.png'
import listener from '../../../assets/tabs/listener.png'
import radioSelected from '../../../assets/tabs/radio-selected.png'
import radio from '../../../assets/tabs/radio.png'

const tabIcons = {
  home: { default: radio, selected: radioSelected },
  tweets: { default: editorial, selected: editorialSelected },
  profile: { default: listener, selected: listenerSelected },
}

export default function TabsLayout() {
  const colors = useThemeColors()
  useColorSchemePreference()
  const { track } = useNowPlaying()

  return (
    <NativeTabs
      blurEffect='systemDefault'
      minimizeBehavior='onScrollDown'
      tintColor={colors.tabActive}
      labelStyle={{ color: colors.tabInactive }}>
      {track ? (
        <NativeTabs.BottomAccessory>
          <MiniPlayerBar />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name='(home)' contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Icon src={tabIcons.home} renderingMode='template' />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='(tweets)' contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Icon src={tabIcons.tweets} renderingMode='template' />
        <NativeTabs.Trigger.Label>Tweets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='profile' contentStyle={{ backgroundColor: colors.background }}>
        <NativeTabs.Trigger.Icon src={tabIcons.profile} renderingMode='template' />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
