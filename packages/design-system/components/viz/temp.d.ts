/** Shared temperature scale: cool = structural, warm = changed, hot = risky. */
export interface TempStop {
  key: number;
  token: string;
  hex: string;
  label: string;
}

export declare const TEMP_STOPS: TempStop[];

/** Clamp any 0..7 temperature to its stop. */
export declare function tempStop(t: number): TempStop;
export declare function tempColor(t: number): string;
export declare function tempHex(t: number): string;
