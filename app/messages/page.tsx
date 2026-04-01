const conversations = [
  {
    name: "FC Unitr Wolves",
    last: "Ryan: Don't forget training Thursday!",
    time: "2m",
    unread: 3,
    group: true,
  },
  {
    name: "Liam Foster",
    last: "Good game yesterday mate 🔥",
    time: "1h",
    unread: 1,
    group: false,
  },
  {
    name: "Hackney 5-a-side",
    last: "Organiser: Pitch confirmed ✅",
    time: "3h",
    unread: 0,
    group: true,
  },
  {
    name: "Marcus Webb",
    last: "Can you cover GK on Sunday?",
    time: "Yesterday",
    unread: 0,
    group: false,
  },
  {
    name: "Victoria Park League",
    last: "Fixtures for next month posted",
    time: "2d",
    unread: 0,
    group: true,
  },
];

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

      <div className="flex-1">
        {conversations.map((conv) => (
          <button
            key={conv.name}
            className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-border hover:bg-surface-2 transition-colors text-left"
          >
            {/* Avatar */}
            <div className="w-11 h-11 rounded-full bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold text-text-secondary">
                {conv.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-sm font-semibold truncate">{conv.name}</p>
                <span className="text-xs text-text-secondary flex-shrink-0 ml-2">{conv.time}</span>
              </div>
              <p className="text-xs text-text-secondary truncate">{conv.last}</p>
            </div>
            {/* Unread badge */}
            {conv.unread > 0 && (
              <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-black">{conv.unread}</span>
              </div>
            )}
          </button>
        ))}
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
