export default function MessagesPage() {
  return (
    <div className="flex flex-col min-h-screen pt-12">
      <header className="px-4 mb-6">
        <h1 className="text-2xl font-bold mb-4">Messages</h1>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            placeholder="Search messages..."
            className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-accent/50"
          />
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
        <div className="w-16 h-16 rounded-full bg-surface-2 border border-border flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p className="text-sm font-semibold">No conversations yet</p>
        <p className="text-xs text-text-secondary max-w-[220px]">Team chats, match chats, and direct messages will show up here.</p>
      </div>

      {/* FAB */}
      <button className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent text-black flex items-center justify-center shadow-lg shadow-accent/30">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    </div>
  );
}
