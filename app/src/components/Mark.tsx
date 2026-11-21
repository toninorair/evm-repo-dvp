/** Ethereum Institutional diamond mark, redrawn as vector from the brand avatar. Inherits the text colour. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={(size * 200) / 290} height={size} viewBox="100 55 200 290" fill="currentColor">
      <circle cx="200" cy="71" r="6" /><rect x="185" y="91" width="30" height="12" rx="6" /><rect x="165" y="116" width="70" height="12" rx="6" /><rect x="150" y="142" width="100" height="12" rx="6" /><rect x="125" y="167" width="150" height="12" rx="6" /><rect x="112" y="193" width="176" height="12" rx="6" /><rect x="125" y="218" width="150" height="12" rx="6" /><rect x="150" y="244" width="100" height="12" rx="6" /><rect x="165" y="269" width="70" height="12" rx="6" /><rect x="185" y="295" width="30" height="12" rx="6" /><circle cx="200" cy="328" r="6" />
    </svg>
  )
}
