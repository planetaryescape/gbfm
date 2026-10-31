export const animatePageTransition = (previous: string, next: string) =>
  previous !== next && !(previous.startsWith('/tweet/') && next.startsWith('/tweet/'))
