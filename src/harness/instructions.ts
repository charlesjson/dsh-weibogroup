import { IMAGE_INSTRUCTIONS } from './instructions/images.js'
import { COLLECTION_INSTRUCTIONS } from './instructions/collection.js'
import { NOTIFICATION_INSTRUCTIONS } from './instructions/notifications.js'
import { INSTRUCTIONS } from './instructions/query.js'
import { EXPORT_INSTRUCTIONS } from './instructions/exports.js'
import { MONITOR_INSTRUCTIONS } from './instructions/monitor.js'

/** Keep workflow guidance separate; preserve order in the host prompt. */
export const ARCHIVE_INSTRUCTIONS = [
  INSTRUCTIONS,
  EXPORT_INSTRUCTIONS,
  MONITOR_INSTRUCTIONS,
  COLLECTION_INSTRUCTIONS,
  NOTIFICATION_INSTRUCTIONS,
  IMAGE_INSTRUCTIONS,
].join('\n')
