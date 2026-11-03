import * as Haptics from 'expo-haptics'

const ignore = () => {}

export const haptics = {
  select: () => Haptics.selectionAsync().catch(ignore),
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore),
  edge: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(ignore),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore),
  failure: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(ignore),
}
