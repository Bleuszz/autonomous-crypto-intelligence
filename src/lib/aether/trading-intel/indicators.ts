import { candlesAsOf, lastCandle, typicalPrice } from "./candles.ts";
import { TRADING_INTEL_VERSION, type IndicatorReading, type Ohlcv, type Timeframe } from "./types.ts";
const VERSION = `${TRADING_INTEL_VERSION}+ind-1`;
function mean(xs: number[]) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function stdev(xs: number[]) { if (xs.length<2) return 0; const m=mean(xs); return Math.sqrt(xs.reduce((a,x)=>a+(x-m)**2,0)/(xs.length-1)); }
function reading(p: Omit<IndicatorReading,"version"|"source">&{source?:string}): IndicatorReading { return {...p, version: VERSION, source: p.source ?? "ohlcv"}; }
function unavailable(name: IndicatorReading["name"], timeframe: Timeframe, timestamp: string, window: number, reason: string): IndicatorReading {
  return reading({ name, timeframe, timestamp, window, value: null, extras: {}, freshness: reason.includes("UNAVAILABLE") ? "UNAVAILABLE" : "INSUFFICIENT", reason });
}
export function sma(values: number[], period: number): number | null { if (values.length < period || period<=0) return null; return mean(values.slice(-period)); }
export function ema(values: number[], period: number): number | null {
  if (values.length < period || period<=0) return null;
  const k = 2/(period+1); let e = mean(values.slice(0,period));
  for (let i=period;i<values.length;i++) e = values[i]!*k + e*(1-k);
  return e;
}
export function rsi(values: number[], period=14): number | null {
  if (values.length < period+1) return null;
  let gain=0, loss=0;
  for (let i=1;i<=period;i++) { const d=values[i]!-values[i-1]!; if (d>=0) gain+=d; else loss-=d; }
  let avgGain=gain/period, avgLoss=loss/period;
  for (let i=period+1;i<values.length;i++) {
    const d=values[i]!-values[i-1]!;
    avgGain=(avgGain*(period-1)+(d>0?d:0))/period;
    avgLoss=(avgLoss*(period-1)+(d<0?-d:0))/period;
  }
  if (avgLoss===0) return 100;
  return 100-100/(1+avgGain/avgLoss);
}
export function macd(values: number[], fast=12, slow=26, signal=9) {
  if (values.length < slow+signal) return null;
  const series: number[] = [];
  for (let i=slow;i<=values.length;i++) {
    const sl=values.slice(0,i); const f=ema(sl,fast); const s=ema(sl,slow);
    if (f==null||s==null) continue; series.push(f-s);
  }
  if (series.length<signal) return null;
  const sig=ema(series,signal); if (sig==null) return null;
  const last=series[series.length-1]!;
  return { macd: last, signal: sig, hist: last-sig };
}
export function atr(candles: Ohlcv[], period=14): number | null {
  if (candles.length<period+1) return null;
  const trs: number[] = [];
  for (let i=1;i<candles.length;i++) {
    const c=candles[i]!, p=candles[i-1]!;
    trs.push(Math.max(c.h-c.l, Math.abs(c.h-p.c), Math.abs(c.l-p.c)));
  }
  if (trs.length<period) return null;
  let a=mean(trs.slice(0,period));
  for (let i=period;i<trs.length;i++) a=(a*(period-1)+trs[i]!)/period;
  return a;
}
export function bollinger(values: number[], period=20, k=2) {
  if (values.length<period) return null;
  const w=values.slice(-period); const mid=mean(w); const sd=stdev(w);
  const upper=mid+k*sd, lower=mid-k*sd;
  return { mid, upper, lower, widthPct: mid?((upper-lower)/mid)*100:0 };
}
export function vwap(candles: Ohlcv[]): number | null {
  let pv=0, vol=0;
  for (const c of candles) { if (c.v==null || !(c.v>0)) continue; pv+=typicalPrice(c)*c.v; vol+=c.v; }
  return vol>0 ? pv/vol : null;
}
export function adx(candles: Ohlcv[], period=14): number | null {
  if (candles.length<period*2) return null;
  const plusDM:number[]=[], minusDM:number[]=[], trs:number[]=[];
  for (let i=1;i<candles.length;i++) {
    const c=candles[i]!, p=candles[i-1]!;
    const up=c.h-p.h, down=p.l-c.l;
    plusDM.push(up>down && up>0 ? up : 0);
    minusDM.push(down>up && down>0 ? down : 0);
    trs.push(Math.max(c.h-c.l, Math.abs(c.h-p.c), Math.abs(c.l-p.c)));
  }
  const smooth=(xs:number[])=>{ let s=mean(xs.slice(0,period)); const out=[s]; for(let i=period;i<xs.length;i++){ s=s-s/period+xs[i]!; out.push(s);} return out; };
  const sPlus=smooth(plusDM), sMinus=smooth(minusDM), sTr=smooth(trs);
  const dx:number[]=[];
  const n=Math.min(sPlus.length,sMinus.length,sTr.length);
  for (let i=0;i<n;i++) {
    const tr=sTr[i]!; if(!(tr>0)) continue;
    const pdi=(sPlus[i]!/tr)*100, mdi=(sMinus[i]!/tr)*100, den=pdi+mdi;
    dx.push(den===0?0:(Math.abs(pdi-mdi)/den)*100);
  }
  if (dx.length<period) return null;
  let a=mean(dx.slice(0,period));
  for (let i=period;i<dx.length;i++) a=(a*(period-1)+dx[i]!)/period;
  return a;
}
export function obv(candles: Ohlcv[]): number | null {
  if (candles.length<2) return null;
  if (candles.some(c=>c.v==null)) return null;
  let acc=0;
  for (let i=1;i<candles.length;i++) {
    const v=candles[i]!.v??0;
    if (candles[i]!.c>candles[i-1]!.c) acc+=v;
    else if (candles[i]!.c<candles[i-1]!.c) acc-=v;
  }
  return acc;
}
export function computeIndicators(opts:{timeframe:Timeframe;candles:Ohlcv[]|undefined;decisionTimestamp:string}): IndicatorReading[] {
  const candles=candlesAsOf(opts.candles, opts.decisionTimestamp);
  const last=lastCandle(candles); const ts=opts.decisionTimestamp; const tf=opts.timeframe;
  if (!last || candles.length<8) {
    return (["RSI","MACD","EMA","SMA","ATR","BB","VWAP","ADX","OBV"] as const).map(name=>unavailable(name,tf,ts,0,"INSUFFICIENT historical candles"));
  }
  const closes=candles.map(c=>c.c); const out: IndicatorReading[]=[];
  const rsiV=rsi(closes,14);
  out.push(rsiV==null?unavailable("RSI",tf,ts,14,"INSUFFICIENT window for RSI-14"):reading({name:"RSI",timeframe:tf,timestamp:ts,window:14,value:rsiV,extras:{},freshness:"AVAILABLE",reason:"RSI-14 Wilder"}));
  const macdV=macd(closes);
  out.push(macdV==null?unavailable("MACD",tf,ts,26,"INSUFFICIENT window for MACD"):reading({name:"MACD",timeframe:tf,timestamp:ts,window:26,value:macdV.macd,extras:{signal:macdV.signal,hist:macdV.hist},freshness:"AVAILABLE",reason:"MACD 12/26/9"}));
  const ema21=ema(closes,21);
  out.push(ema21==null?unavailable("EMA",tf,ts,21,"INSUFFICIENT window for EMA-21"):reading({name:"EMA",timeframe:tf,timestamp:ts,window:21,value:ema21,extras:{last:last.c},freshness:"AVAILABLE",reason:"EMA-21"}));
  const sma20=sma(closes,20);
  out.push(sma20==null?unavailable("SMA",tf,ts,20,"INSUFFICIENT window for SMA-20"):reading({name:"SMA",timeframe:tf,timestamp:ts,window:20,value:sma20,extras:{last:last.c},freshness:"AVAILABLE",reason:"SMA-20"}));
  const atrV=atr(candles,14);
  out.push(atrV==null?unavailable("ATR",tf,ts,14,"INSUFFICIENT window for ATR-14"):reading({name:"ATR",timeframe:tf,timestamp:ts,window:14,value:atrV,extras:{atrPct:last.c?(atrV/last.c)*100:null},freshness:"AVAILABLE",reason:"ATR-14"}));
  const bb=bollinger(closes,20,2);
  out.push(bb==null?unavailable("BB",tf,ts,20,"INSUFFICIENT window for Bollinger-20"):reading({name:"BB",timeframe:tf,timestamp:ts,window:20,value:bb.mid,extras:{upper:bb.upper,lower:bb.lower,widthPct:bb.widthPct,last:last.c},freshness:"AVAILABLE",reason:"Bollinger 20,2"}));
  const vwapV=vwap(candles);
  out.push(vwapV==null?unavailable("VWAP",tf,ts,candles.length,"UNAVAILABLE: no volume on candles"):reading({name:"VWAP",timeframe:tf,timestamp:ts,window:candles.length,value:vwapV,extras:{last:last.c},freshness:"AVAILABLE",reason:"Session VWAP"}));
  const adxV=adx(candles,14);
  out.push(adxV==null?unavailable("ADX",tf,ts,14,"INSUFFICIENT window for ADX-14"):reading({name:"ADX",timeframe:tf,timestamp:ts,window:14,value:adxV,extras:{},freshness:"AVAILABLE",reason:"ADX-14"}));
  const obvV=obv(candles);
  out.push(obvV==null?unavailable("OBV",tf,ts,candles.length,"UNAVAILABLE: volume missing on one or more candles"):reading({name:"OBV",timeframe:tf,timestamp:ts,window:candles.length,value:obvV,extras:{},freshness:"AVAILABLE",reason:"On-balance volume"}));
  return out;
}
