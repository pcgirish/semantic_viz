import * as React from "react";

/** Repo / ref / path breadcrumb in mono type. */
export interface CrumbSegment{label:string;icon?:string;
  /** Hover text when the label is an abbreviation of something longer (e.g. a file path). */
  title?:string}
export interface PathBreadcrumbProps{
  segments:CrumbSegment[];
  onPick?:(index:number)=>void;
  style?:React.CSSProperties;
}
export declare function PathBreadcrumb(props:PathBreadcrumbProps):JSX.Element;
