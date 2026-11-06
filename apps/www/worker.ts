import foldkit from './dist/server/fetch.js'
import { websiteFetch } from './src/server/worker-fetch'

export default { fetch: websiteFetch(foldkit.fetch) }
