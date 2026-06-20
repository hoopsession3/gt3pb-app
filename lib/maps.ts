// Open native turn-by-turn directions to a coordinate. The universal Google Maps
// "dir" URL hands off to the Maps app on iOS/Android (or the web) and works
// cross-platform without an API key.
export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function openDirections(lat: number, lng: number) {
  if (typeof window !== "undefined") {
    window.open(directionsUrl(lat, lng), "_blank", "noopener,noreferrer");
  }
}
