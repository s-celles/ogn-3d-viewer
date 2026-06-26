// deck.gl is loaded as a UMD global (window.deck) by a classic <script> tag in
// index.html, so it is available before any module evaluates. Re-export the
// pieces we use as named bindings.
export const {
  Deck, MapView, FirstPersonView, TileLayer, SimpleMeshLayer, PathLayer, TripsLayer,
  ScatterplotLayer, LightingEffect, AmbientLight, DirectionalLight, COORDINATE_SYSTEM
} = window.deck;
