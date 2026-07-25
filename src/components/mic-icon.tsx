export function MicIcon({ listening }: { listening?: boolean }) {
  if (listening) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        fill="currentColor"
      >
        <rect x="6" y="6" width="12" height="12" rx="2.5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a3.2 3.2 0 0 0-3.2 3.2v6.1a3.2 3.2 0 1 0 6.4 0V6.2A3.2 3.2 0 0 0 12 3Z" />
      <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0" />
      <path d="M12 17.7v3.1" />
      <path d="M9 20.8h6" />
    </svg>
  );
}
