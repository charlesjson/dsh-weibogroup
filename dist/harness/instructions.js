import { INSTRUCTIONS } from './instructions/query.js';
import { EXPORT_INSTRUCTIONS } from './instructions/exports.js';
import { MONITOR_INSTRUCTIONS } from './instructions/monitor.js';
/** Keep workflow guidance separate; preserve order in the host prompt. */
export const ARCHIVE_INSTRUCTIONS = [INSTRUCTIONS, EXPORT_INSTRUCTIONS, MONITOR_INSTRUCTIONS].join('\n');
