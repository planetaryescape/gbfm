import handler, { instrumentWorker } from './dist/server/fetch.js'

export default instrumentWorker(handler)
