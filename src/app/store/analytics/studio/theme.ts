import { studioTheme } from "ag-studio";

/**
 * AG Studio theme for Allowance. Values point at the same CSS variables as the rest of the app
 * (src/app/globals.css), so the dashboard renders as part of the page: navy primary, cool neutrals,
 * white cards, Geist.
 */
const v = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: v(color) });

// Categorical palette tuned to the app. Order matters: series 1 navy, 2 red, 3 amber, 4 emerald, so the
// default outcome series (Charged, Blocked, Waiting) read navy / red / amber.
const PALETTE = ["#1e2f5a", "#dc2626", "#d97706", "#059669", "#7c3aed", "#0284c7", "#64748b", "#0d9488", "#be185d", "#4d7c0f"];
const palette = Object.fromEntries(
  PALETTE.flatMap((c, i) => [
    [`chartPaletteFills${i + 1}Color`, c],
    [`chartPaletteStrokes${i + 1}Color`, c],
  ]),
);

export const FONT = 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif';

export const allowanceTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: v("foreground"),
  foregroundColor: v("foreground"),
  subtleTextColor: v("muted-foreground"),
  backgroundColor: v("card"),
  borderColor: v("border"),
  accentColor: v("primary"),
  iconColor: v("primary"),
  rowHoverColor: v("muted"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("background"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("background"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: v("card"),
  studioWidgetBorder: line("border"),
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: v("foreground"),
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: v("muted-foreground"),
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: v("muted-foreground"),
  studioWidgetResizeBorderColor: v("primary"),

  studioPanelContainerBackgroundColor: v("card"),
  studioPanelContainerBorder: line("border"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: v("border"),
  studioPanelDividerActiveColor: v("primary"),
  studioPanelSectionBorderColor: v("border"),
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: v("muted"),
  studioPanelChevronButtonHoverColor: v("primary"),
  studioToggleButtonActiveBackgroundColor: v("accent"),
  studioToggleButtonActiveBorderColor: v("primary"),
  studioToggleButtonActiveColor: v("primary"),

  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: v("foreground"),
  gridHeaderBackgroundColor: v("card"),
  gridHeaderTextColor: v("muted-foreground"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: line("border"),
  gridHeaderRowBorder: line("border"),
  gridPinnedRowBorder: line("border"),
  gridRowHoverColor: v("muted"),
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: v("foreground"),
  chartSubtleTextColor: v("muted-foreground"),
  chartAxisLineColor: v("border"),
  chartGridLineColor: v("border"),
  ...palette,
});
