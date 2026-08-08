import * as React from "react";

/**
 * Faceted action button — the primary commit/action control across CodeDream surfaces.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  /** solid = filled, outline = hairline, ghost = quiet fill */
  variant?: "solid" | "outline" | "ghost";
  /** semantic temperature of the action */
  tone?: "accent" | "neutral" | "warm" | "risk";
  size?: "sm" | "md" | "lg";
  /** chamfered corners (default) vs plain radius */
  faceted?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}
export declare function Button(props: ButtonProps): JSX.Element;
