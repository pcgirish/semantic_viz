import React from "react";

/**
 * Kebab-case name aliases mapped to Material Symbols Rounded ligature names.
 * An unmapped name renders an empty, correctly-sized box — never a filled block.
 */
export const ICON_MAP = {
  "box": "deployed_code",
  "file-code": "code_blocks",
  "folder": "folder",
  "git-branch": "fork_right",
  "git-compare": "compare_arrows",
  "git-pull-request": "merge_type",
  "git-commit-horizontal": "commit",
  "git-fork": "call_split",
  "git-merge": "merge_type",
  "activity": "show_chart",
  "flame": "local_fire_department",
  "layers": "layers",
  "crosshair": "center_focus_strong",
  "thermometer": "device_thermostat",
  "history": "history",
  "database": "database",
  "terminal": "terminal",
  "share-2": "share",
  "settings": "settings",
  "search": "search",
  "zoom-in": "zoom_in",
  "zoom-out": "zoom_out",
  "maximize": "open_in_full",
  "chevron-down": "keyboard_arrow_down",
  "chevron-right": "chevron_right",
  "chevron-left": "chevron_left",
  "check": "check",
  "x": "close",
  "alert-triangle": "warning",
  "users": "group",
  "list-checks": "checklist",
  "circle-user": "account_circle",
  "undo-2": "undo",
  "pencil": "edit",
  "lock": "lock",
  "clock": "schedule",
  "play": "play_arrow",
  "arrow-right": "arrow_forward",
  "square": "crop_square",
  "columns-2": "view_column",
  "align-left": "format_align_left",
  "rotate-3d": "view_in_ar",
  "tag": "sell",
  "trash-2": "delete",
  "share": "share",
  "code": "code",
  "link": "link",
  "filter": "filter_alt",
  "eye": "visibility",
  "copy": "content_copy",
  "plus": "add",
  "minus": "remove",
  "gauge": "speed"
};

/**
 * Thin wrapper over the Material Symbols Rounded webfont: renders the mapped ligature so the
 * glyph inherits currentColor (and therefore the temperature scale) and scales with font-size.
 * SUBSTITUTION: no proprietary icon set was provided with the brief — see readme.md Iconography.
 */
export function Icon({ name, size = 16, style, ...rest }) {
  const lig = ICON_MAP[name];
  if (!lig) return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, flex: "0 0 auto", ...style }} {...rest} />;
  return (
    <span aria-hidden="true" className="material-symbols-rounded" style={{
      fontFamily: "'Material Symbols Rounded'", fontSize: size, width: size, height: size,
      lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
      flex: "0 0 auto", fontWeight: 300, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
      ...style
    }} {...rest}>{lig}</span>
  );
}
