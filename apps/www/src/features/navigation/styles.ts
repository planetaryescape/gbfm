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
  .tweet-reader-options {
    position: static;
    max-height: none;
    width: 100%;
    margin-bottom: 6rem;
  }
  .station-navigation .station-fallback {
    display: flex;
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 40;
    background: var(--background);
  }
  .station-navigation .station-desktop,
  .station-navigation .mobile-dock { display: none; }
}
`
