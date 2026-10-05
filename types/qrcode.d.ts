// Minimal ambient declaration so the project type-checks before `qrcode`
// is installed. Once you run `npm install qrcode`, the package's own
// bundled types (if you also install `@types/qrcode`) will take over —
// this file is a harmless fallback either way.
declare module 'qrcode' {
  export function toDataURL(text: string, options?: any): Promise<string>
}