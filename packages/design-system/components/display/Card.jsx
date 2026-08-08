import React from "react";

/** Hairline surface container. Faceted corner optional; never a colored left border. */
export function Card({children,title,meta,tone="neutral",faceted,padding="var(--gutter-panel)",style,...rest}){
  const edge={neutral:"var(--border-1)",cool:"rgba(31,182,193,.35)",warm:"rgba(242,169,59,.35)",risk:"rgba(232,67,79,.4)"}[tone];
  return (
    <section style={{background:"var(--surface-1)",border:`var(--border-w) solid ${edge}`,borderRadius:faceted?0:"var(--radius-md)",clipPath:faceted?"var(--clip-chamfer)":"none",boxShadow:"var(--shadow-2)",...style}} {...rest}>
      {(title||meta)&&(
        <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"10px 14px",borderBottom:"var(--border-w) solid var(--border-hair)"}}>
          <h3 style={{font:"var(--type-h3)",fontSize:"var(--text-base)"}}>{title}</h3>
          {meta&&<span className="cd-mono-caps">{meta}</span>}
        </header>
      )}
      <div style={{padding}}>{children}</div>
    </section>
  );
}
