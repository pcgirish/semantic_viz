/** Shared temperature scale: cool = structural, warm = changed, hot = risky. */
export const TEMP_STOPS=[
  {key:0,token:"var(--temp-0)",hex:"#3A4C5F",label:"dormant"},
  {key:1,token:"var(--temp-1)",hex:"#1FB6C1",label:"stable"},
  {key:2,token:"var(--temp-2)",hex:"#2ED3A7",label:"active"},
  {key:3,token:"var(--temp-3)",hex:"#C9D93F",label:"warm"},
  {key:4,token:"var(--temp-4)",hex:"#F2A93B",label:"changed"},
  {key:5,token:"var(--temp-5)",hex:"#F2713B",label:"hot"},
  {key:6,token:"var(--temp-6)",hex:"#E8434F",label:"risk"},
  {key:7,token:"var(--temp-7)",hex:"#CC2E6E",label:"critical"}
];
/** Clamp any 0..7 temperature to its stop. */
export function tempStop(t){return TEMP_STOPS[Math.max(0,Math.min(7,Math.round(t||0)))];}
export function tempColor(t){return tempStop(t).token;}
export function tempHex(t){return tempStop(t).hex;}
