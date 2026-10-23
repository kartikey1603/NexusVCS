import React from 'react';

// A tiny inline SVG mark (a branching/version-graph glyph) paired with the wordmark. Single
// source of truth for branding so every page renders the same mark instead of plain text.
export default function Logo({ withText = true, size = 20 }) {
  return <span className="logo-mark" aria-label="NexusVCS">
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 8.4V15.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.2 7.2C11 8.6 13 9.8 15.8 11.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.2 16.8C11 15.4 13 14.2 15.8 12.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
    {withText && <span className="logo-text">NexusVCS</span>}
  </span>;
}
