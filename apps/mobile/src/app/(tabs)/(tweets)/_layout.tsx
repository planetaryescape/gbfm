import { Stack } from 'expo-router'

import { useStackScreenOptions } from '@/theme/navigation'

export default function TweetsStackLayout() {
  const screenOptions = useStackScreenOptions()

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name='index' options={{ headerShown: false }} />
      <Stack.Screen name='archive' options={{ headerShown: true, title: 'tweet archive' }} />
      <Stack.Screen name='tweet/[slug]' options={{ headerShown: true, title: 'tweet' }} />
      <Stack.Screen
        name='replies/[slug]'
        options={{
          headerShown: false,
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
          sheetExpandsWhenScrolledToEdge: true,
        }}
      />
    </Stack>
  )
}
