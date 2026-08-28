export const normalizeText=(v:unknown)=>String(v??'').replace(/\u00a0/g,' ').trim().replace(/\s+/g,' ');
export const normalizeKey=(v:unknown)=>normalizeText(v).toLocaleLowerCase('ru-RU');
export function parseOptionalNumber(v:unknown):number|null{if(typeof v==='number'&&Number.isFinite(v))return v;const s=normalizeText(v);if(!s)return null;const n=Number(s.replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null}
export const parseStockNumber=(v:unknown)=>parseOptionalNumber(v)??0;
