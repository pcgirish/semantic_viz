export type Theme = {
  ink: string;
  slate: string;
  hair: string;
  added: string;
  removed: string;
  modified: string;
  hi: string;
};

/** Default tiles theme. A skin may reinterpret the theme freely, never the encoding (docs/serve.md#6). */
export const defaultTheme: Theme = {
  ink: "#1a1a1a",
  slate: "#5b6472",
  hair: "#d8dce1",
  added: "#1f9d55",
  removed: "#d64545",
  modified: "#c98a1f",
  hi: "#d64545",
};
