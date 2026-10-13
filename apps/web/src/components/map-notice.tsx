/** Fond de carte indisponible (MapTiler et OpenStreetMap) : les tracés et les points restent. */
export function MapUnavailableNotice() {
  return (
    <p
      role="status"
      className="pointer-events-none absolute bottom-2 left-1/2 z-[1000] -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1 text-xs text-muted shadow"
    >
      Fond de carte indisponible : les tracés et les points restent affichés.
    </p>
  );
}
