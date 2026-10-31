/// <reference types="nativewind/types" />

declare module '*.css'

declare module '*.ttf'

declare module '*.png' {
  const source: number

  export default source
}
