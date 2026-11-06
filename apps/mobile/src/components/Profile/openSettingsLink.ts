import { Alert, Linking } from 'react-native'

export const openSettingsLink = (url: string) => {
  void Linking.openURL(url).catch(() => Alert.alert('Could not open link', 'Please try again.'))
}
