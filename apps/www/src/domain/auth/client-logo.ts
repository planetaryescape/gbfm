import { Schema } from 'effect'

const publicLogoUrl = (value: string) => {
  const url = URL.parse(value)

  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  return (
    host.length <= 253 &&
    host.includes('.') &&
    /^[a-z0-9.-]+$/.test(host) &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
    !['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'home', 'lan'].some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  )
}

export const ClientLogoUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter(publicLogoUrl),
).pipe(Schema.brand('ClientLogoUrl'))

export type ClientLogoUrl = typeof ClientLogoUrl.Type

export const parseClientLogo = Schema.decodeUnknownOption(ClientLogoUrl)

export const clientLogoScript = `for(const image of document.querySelectorAll('[data-client-logo]')){const initial=image.parentElement.querySelector('[data-client-initial]');const show=()=>{if(image.naturalWidth){image.hidden=false;initial.hidden=true}};const fail=()=>image.remove();image.addEventListener('load',show,{once:true});image.addEventListener('error',fail,{once:true});if(image.complete){if(image.naturalWidth)show();else fail()}}`

export const clientLogoScriptHash = 'sha256-/60j4O3goc9HSdeAYsUeZKaHdgLlvYYYM3tD2iipRLc='
