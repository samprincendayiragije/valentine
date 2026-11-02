import qrcode from 'qrcode-generator'

// Renders a QR code as plain SVG elements (no innerHTML, no inline styles, CSP-friendly).
export default function Qr({ text, label }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const pad = 4
  let d = ''
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`
  const size = n + pad * 2
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="w-48 h-48 rounded-lg bg-white" shapeRendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  )
}
