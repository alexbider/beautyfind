// Re-mounts on every navigation, so each screen enters with the push transition (globals.css).
// The outer box clips horizontally and stays put; only the inner one slides, so the slide can't
// widen the phone viewport.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="bf-page">
      <div className="bf-page-in">{children}</div>
    </div>
  );
}
