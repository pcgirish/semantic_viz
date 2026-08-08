import * as React from "react";

/** Centered modal over a scrim. */
export interface DialogProps{
  open?:boolean;
  onClose?:()=>void;
  title?:React.ReactNode;
  meta?:React.ReactNode;
  children?:React.ReactNode;
  footer?:React.ReactNode;
  width?:number;
}
export declare function Dialog(props:DialogProps):JSX.Element|null;
