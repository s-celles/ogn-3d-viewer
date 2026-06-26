// ============ track geometry & time helpers ============
import { S } from './state.js';

// The track currently followed in cockpit view.
export const subjectTrack = () => S.TRACKS.find(tr=>tr.reg===S.subject) || S.TRACKS[0];

// Whether a track should be drawn (cockpit shows all; overview honours solo).
export function shown(tr){ if(S.mode==='fpv') return true; return !S.solo || S.solo===tr.reg; }

// Track path with the current vertical exaggeration applied.
export function scaled(tr){ const k=S.exo; return tr.rel.map(p=>[p[0],p[1],p[2]*k]); }

// Interpolated [lon,lat,alt] at a given relative time.
export function posAt(tr, time){
  const P=tr.rel;
  if(time<=tr.rstart) return P[0]; if(time>=tr.rend) return P[P.length-1];
  for(let i=1;i<P.length;i++){ if(P[i][3]>=time){ const a=P[i-1],b=P[i],f=(time-a[3])/Math.max(1e-3,b[3]-a[3]);
    return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f]; } }
  return P[P.length-1];
}

export const airborne = (tr,time) => time>=tr.rstart && time<=tr.rend;

// Path points between two relative times (clamped to the track span).
export function slice(tr,t0,t1){ t0=Math.max(t0,tr.rstart); t1=Math.min(t1,tr.rend); if(t1<=t0) return [];
  const out=[posAt(tr,t0)]; for(const p of tr.rel){ if(p[3]>t0&&p[3]<t1) out.push([p[0],p[1],p[2]]); }
  out.push(posAt(tr,t1)); return out; }

// Bearing (degrees) from point a to point b, or null if they coincide.
export function brg(a,b){ const lat=(a[1]+b[1])/2*Math.PI/180, e=(b[0]-a[0])*Math.cos(lat), n=(b[1]-a[1]);
  if(Math.abs(e)<1e-9&&Math.abs(n)<1e-9) return null; return (Math.atan2(e,n)*180/Math.PI+360)%360; }

export function headingAt(tr,time){ return brg(posAt(tr,Math.max(tr.rstart,time-3)), posAt(tr,Math.min(tr.rend,time+3))) ?? 0; }

export function varioAt(tr,time){ const t0=Math.max(tr.rstart,time-4),t1=Math.min(tr.rend,time+4),a=posAt(tr,t0),b=posAt(tr,t1),dt=t1-t0;
  return dt>0?(b[2]-a[2])/dt:0; }

export const clampCur = tr => Math.max(tr.rstart, Math.min(tr.rend, S.cur));

// Format a relative time as a local HH:MM:SS clock string.
export function fmt(secRel){ const utc=S.G0+secRel+(S.AF?S.AF.tz_off:0)*3600, z=n=>String(n).padStart(2,'0');
  return `${z(Math.floor(utc/3600)%24)}:${z(Math.floor(utc/60)%60)}:${z(Math.floor(utc)%60)}`; }
