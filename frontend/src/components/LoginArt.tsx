/**
 * Decorative illustration for the login page's dark panel.
 * Shows the plant ledger flow: Purchases -> Production -> Stock,
 * drawn in the panel's own palette so it stays quiet, not loud.
 */
export function LoginArt() {
  return (
    <svg
      viewBox="0 0 560 340"
      aria-hidden="true"
      className="w-full max-w-md"
    >
      <defs>
        <radialGradient id="loginGlow" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#0d8b82" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0d8b82" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="560" height="340" fill="url(#loginGlow)" />

      {/* faint ledger lines in the background */}
      <g stroke="#e5f5f3" strokeOpacity="0.07" strokeWidth="1.5">
        <line x1="40" y1="288" x2="520" y2="288" />
        <line x1="40" y1="308" x2="520" y2="308" />
        <line x1="40" y1="328" x2="430" y2="328" />
      </g>

      {/* connector arrows */}
      <g stroke="#0d8b82" strokeWidth="2" strokeLinecap="round">
        <line x1="172" y1="120" x2="204" y2="120" />
        <polyline points="196,112 206,120 196,128" fill="none" />
        <line x1="356" y1="120" x2="388" y2="120" />
        <polyline points="380,112 390,120 380,128" fill="none" />
      </g>

      {/* card 1: Purchases */}
      <g>
        <rect x="52" y="60" width="120" height="120" rx="14" fill="#12444a" stroke="#e5f5f3" strokeOpacity="0.14" />
        <g stroke="#7fd4c9" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M92 96 h36 v30 h-36 z" />
          <path d="M99 96 v-8 h22 v8" />
          <path d="M110 112 v10 m0 0 l-6 -6 m6 6 l6 -6" />
        </g>
        <text x="112" y="152" textAnchor="middle" fill="#e5f5f3" fontSize="15" fontWeight="600">Purchases</text>
        <text x="112" y="170" textAnchor="middle" fill="#9bc0be" fontSize="12">42 lots in</text>
      </g>

      {/* card 2: Production */}
      <g>
        <rect x="220" y="60" width="120" height="120" rx="14" fill="#12444a" stroke="#e5f5f3" strokeOpacity="0.14" />
        <g stroke="#7fd4c9" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M262 100 l18 -8 18 8 -18 8 z" />
          <path d="M262 112 l18 8 18 -8" />
          <path d="M262 122 l18 8 18 -8" />
        </g>
        <text x="280" y="152" textAnchor="middle" fill="#e5f5f3" fontSize="15" fontWeight="600">Production</text>
        <text x="280" y="170" textAnchor="middle" fill="#9bc0be" fontSize="12">69 cases + 1 loose</text>
      </g>

      {/* card 3: Stock */}
      <g>
        <rect x="404" y="60" width="120" height="120" rx="14" fill="#12444a" stroke="#e5f5f3" strokeOpacity="0.14" />
        <g stroke="#7fd4c9" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="444" y="94" width="40" height="34" rx="3" />
          <line x1="444" y1="105" x2="484" y2="105" />
          <line x1="444" y1="116" x2="484" y2="116" />
          <line x1="458" y1="94" x2="458" y2="128" />
          <line x1="470" y1="94" x2="470" y2="128" />
        </g>
        <text x="464" y="152" textAnchor="middle" fill="#e5f5f3" fontSize="15" fontWeight="600">Stock</text>
        <text x="464" y="170" textAnchor="middle" fill="#9bc0be" fontSize="12">3 warehouses</text>
      </g>

      {/* ledger summary strip */}
      <g>
        <rect x="52" y="212" width="472" height="56" rx="12" fill="#12444a" stroke="#e5f5f3" strokeOpacity="0.12" />
        <circle cx="84" cy="240" r="7" fill="#0d8b82" />
        <text x="102" y="245" fill="#e5f5f3" fontSize="14" fontWeight="600">One plant ledger</text>
        <text x="102" y="262" fill="#9bc0be" fontSize="12">cases · loose slabs · net &amp; gross weight</text>
        <text x="492" y="246" textAnchor="end" fill="#7fd4c9" fontSize="14" fontWeight="700">2,890 kg</text>
      </g>
    </svg>
  );
}
