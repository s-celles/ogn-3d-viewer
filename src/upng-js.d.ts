// Minimal typings for the untyped `upng-js` package (only what we use).
declare module 'upng-js' {
  interface UPNGImage {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  interface UPNGStatic {
    decode(buffer: ArrayBuffer): UPNGImage;
    /** Returns one ArrayBuffer of RGBA bytes per frame. */
    toRGBA8(img: UPNGImage): ArrayBuffer[];
  }
  const UPNG: UPNGStatic;
  export default UPNG;
}
