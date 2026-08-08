import * as React from "react";

/** Material Symbols Rounded ligature glyph. Unmapped names render an empty box. */
export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** kebab-case alias — see ICON_MAP for the vocabulary */
  name: string;
  size?: number;
}
export declare function Icon(props: IconProps): JSX.Element;
export declare const ICON_MAP: Record<string, string>;
