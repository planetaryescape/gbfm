import { useRouter } from 'expo-router'

import Login from '@/components/Login'

export default function SignInScreen() {
  const router = useRouter()

  return (
    <Login onSignedIn={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />
  )
}
