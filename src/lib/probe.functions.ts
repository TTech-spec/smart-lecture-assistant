import { askAttendanceAi } from './attendance-ai.functions';
export const _probe = async () => { try { return await askAttendanceAi({ data: { question:'hi', records:[] } }); } catch(e:any){ return { err: e?.message, stack: e?.stack } } };
