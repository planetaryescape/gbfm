export const navigationStyles = `
.station-navigation .mobile-menu-dialog:popover-open { display: block; }
.station-navigation .menu-sheet[data-starting-style] { transform: translateY(100%); }
.station-navigation .mobile-menu-backdrop[data-starting-style] { opacity: 0; }
.station-navigation .menu-sheet[data-ending-style] {
  transition-duration: 240ms;
  transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}
.station-navigation .mobile-menu-backdrop[data-ending-style] { transition-duration: 240ms; }
.station-navigation .station-fallback { display: none; }
@media (scripting: none) {
  .station-navigation .station-fallback { display: flex; }
  .station-navigation .station-desktop,
  .station-navigation .mobile-dock { display: none; }
}
`
