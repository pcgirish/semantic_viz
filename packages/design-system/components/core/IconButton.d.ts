import * as React from "react";

/** Icon-only square control for rails, toolbars and tray headers. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide icon name, e.g. "git-branch" */
  name: string;
  /** accessible label, also the tooltip */
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  tone?: "neutral" | "risk";
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
